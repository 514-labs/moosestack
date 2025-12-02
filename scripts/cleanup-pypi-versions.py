#!/usr/bin/env python3
"""
Cleanup old PyPI package versions.

This script fetches package information from PyPI's JSON API and identifies
versions older than a specified number of days. It can delete them using
PyPI's web interface.

Dependencies:
    pip install requests

Usage:
    # Dry run (default) - see what would be deleted
    python cleanup-pypi-versions.py --package moose-cli --days 80 --username __token__ --password $PYPI_TOKEN
    
    # Actually delete old versions
    python cleanup-pypi-versions.py --package moose-cli --days 80 --username __token__ --password $PYPI_TOKEN --do-it

Note:
    PyPI doesn't provide an official deletion API, so we use authenticated
    web requests to delete releases. This may break if PyPI changes their
    interface, but it works for now and we'll fix it if/when it breaks.
    
    Yanked versions still count against PyPI storage quotas, so we must
    actually DELETE (not just yank) to free up space.
"""

import argparse
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from typing import List, Tuple, Optional

import requests


def delete_pypi_version(
    session: requests.Session,
    package_name: str,
    version: str
) -> bool:
    """
    Delete a specific version from PyPI using the web interface.
    
    Args:
        session: Authenticated requests session
        package_name: Name of the PyPI package
        version: Version string to delete
    
    Returns:
        True if successful, False otherwise
    """
    try:
        # Get the release management page
        release_url = f"https://pypi.org/manage/project/{package_name}/release/{version}/"
        response = session.get(release_url, timeout=30)
        
        if response.status_code == 404:
            print(f"    → Version not found (may already be deleted)")
            return True
        
        response.raise_for_status()
        
        # Extract CSRF token from the page
        csrf_match = re.search(r'name="csrf_token"[^>]*value="([^"]+)"', response.text)
        if not csrf_match:
            print(f"    ✗ Could not find CSRF token (PyPI interface may have changed)")
            return False
        
        csrf_token = csrf_match.group(1)
        
        # Submit the deletion form
        delete_response = session.post(
            release_url,
            data={
                "csrf_token": csrf_token,
                "confirm_delete_version": version
            },
            timeout=30,
            allow_redirects=True
        )
        
        # Check if deletion was successful
        # After successful deletion, PyPI redirects to the releases page
        if delete_response.status_code == 200 and "releases" in delete_response.url:
            return True
        else:
            print(f"    ✗ Delete request failed (status: {delete_response.status_code})")
            return False
            
    except Exception as e:
        print(f"    ✗ Error: {e}")
        return False


def cleanup_old_versions(
    package_name: str,
    days_to_keep: int,
    username: str,
    password: str,
    dry_run: bool = True
) -> bool:
    """
    Clean up old versions of a PyPI package.
    
    Args:
        package_name: Name of the PyPI package
        days_to_keep: Number of days to keep versions for
        username: PyPI username (use '__token__' for API tokens)
        password: PyPI password or API token
        dry_run: If True, only log what would be deleted (default: True)
    
    Returns:
        True if successful, False otherwise
    """
    print(f"\n{'='*70}")
    print(f"Package: {package_name}")
    print(f"Retention: {days_to_keep} days")
    print(f"Mode: {'DRY RUN' if dry_run else 'LIVE - WILL DELETE'}")
    print(f"{'='*70}\n")
    
    # Get package info from PyPI JSON API
    try:
        response = requests.get(f"https://pypi.org/pypi/{package_name}/json", timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        print(f"ERROR: Failed to fetch {package_name} info: {e}")
        return False
    
    data = response.json()
    releases = data.get("releases", {})
    
    if not releases:
        print(f"No releases found for {package_name}")
        return True
    
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days_to_keep)
    versions_to_delete: List[Tuple[str, datetime]] = []
    
    # Find versions older than cutoff
    for version, files in releases.items():
        if not files:  # Skip versions with no files
            continue
        
        # Get the upload date of the first file
        upload_date_str = files[0].get("upload_time_iso_8601")
        if not upload_date_str:
            continue
        
        upload_date = datetime.fromisoformat(upload_date_str.replace('Z', '+00:00'))
        
        if upload_date < cutoff_date:
            versions_to_delete.append((version, upload_date))
    
    if not versions_to_delete:
        print(f"✓ No versions to delete for {package_name}")
        print(f"  (all versions are newer than {cutoff_date.date()})")
        return True
    
    # Sort by date for logging
    versions_to_delete.sort(key=lambda x: x[1])
    
    print(f"Found {len(versions_to_delete)} versions older than {cutoff_date.date()}\n")
    
    if dry_run:
        print("--- DRY RUN: Would delete the following versions ---\n")
        
        for version, upload_date in versions_to_delete:
            days_old = (datetime.now(timezone.utc) - upload_date).days
            print(f"  • {package_name} v{version}")
            print(f"    Uploaded: {upload_date.date()} ({days_old} days ago)")
            print()
        
        print(f"{'─'*70}")
        print(f"DRY RUN SUMMARY: {len(versions_to_delete)} versions would be deleted")
        print(f"{'─'*70}")
        return True
    
    # Create authenticated session
    session = requests.Session()
    
    # Login to PyPI
    print("Logging in to PyPI...")
    login_url = "https://pypi.org/account/login/"
    
    try:
        # Get login page to extract CSRF token
        login_page = session.get(login_url, timeout=30)
        login_page.raise_for_status()
        
        csrf_match = re.search(r'name="csrf_token"[^>]*value="([^"]+)"', login_page.text)
        if not csrf_match:
            print("ERROR: Could not find CSRF token on login page")
            return False
        
        # Submit login
        login_response = session.post(
            login_url,
            data={
                "csrf_token": csrf_match.group(1),
                "username": username,
                "password": password
            },
            timeout=30,
            allow_redirects=True
        )
        
        # Check if login was successful
        if login_response.status_code != 200 or "Invalid credentials" in login_response.text:
            print("ERROR: Login failed - check credentials")
            return False
        
        print("✓ Logged in successfully\n")
        
    except Exception as e:
        print(f"ERROR: Login failed: {e}")
        return False
    
    # Delete versions
    failed = []
    for version, upload_date in versions_to_delete:
        days_old = (datetime.now(timezone.utc) - upload_date).days
        print(f"  • {package_name} v{version}")
        print(f"    Uploaded: {upload_date.date()} ({days_old} days ago)")
        
        success = delete_pypi_version(session, package_name, version)
        
        if not success:
            failed.append(version)
        else:
            print(f"    ✓ Deleted")
        
        print()
    
    if failed:
        print(f"\n{'─'*70}")
        print(f"ERROR: Failed to delete {len(failed)} versions:")
        for v in failed:
            print(f"  • {v}")
        print(f"{'─'*70}")
        return False
    else:
        print(f"{'─'*70}")
        print(f"✓ Successfully deleted {len(versions_to_delete)} versions")
        print(f"{'─'*70}")
    
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Clean up old PyPI package versions",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Dry run (default) - see what would be deleted
  %(prog)s --package moose-cli --days 80 --username __token__ --password $PYPI_TOKEN
  
  # Actually delete old versions
  %(prog)s --package moose-cli --days 80 --username __token__ --password $PYPI_TOKEN --do-it
  
  # Using environment variables
  export PYPI_USERNAME="__token__"
  export PYPI_PASSWORD="your-pypi-token"
  %(prog)s --package moose-cli --days 80 --do-it
        """
    )
    
    parser.add_argument(
        "--package",
        required=True,
        help="PyPI package name to clean up"
    )
    parser.add_argument(
        "--days",
        type=int,
        required=True,
        help="Number of days to keep versions for"
    )
    parser.add_argument(
        "--username",
        help="PyPI username (use '__token__' for API tokens, or set PYPI_USERNAME env var)"
    )
    parser.add_argument(
        "--password",
        help="PyPI password or API token (can also use PYPI_PASSWORD env var)"
    )
    parser.add_argument(
        "--do-it",
        action="store_true",
        help="Actually delete versions (default is dry-run)"
    )
    
    args = parser.parse_args()
    
    # Get credentials from args or environment
    username = args.username or os.environ.get("PYPI_USERNAME")
    password = args.password or os.environ.get("PYPI_PASSWORD")
    
    if not username or not password:
        print("ERROR: PyPI credentials required")
        print("  Use --username/--password or PYPI_USERNAME/PYPI_PASSWORD env vars")
        sys.exit(1)
    
    # Run cleanup
    success = cleanup_old_versions(
        package_name=args.package,
        days_to_keep=args.days,
        username=username,
        password=password,
        dry_run=not args.do_it
    )
    
    if not success:
        sys.exit(1)
    
    print("\n✓ Cleanup completed successfully")


if __name__ == "__main__":
    main()
