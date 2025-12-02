#!/usr/bin/env python3
"""
Cleanup old PyPI package versions.

This script fetches package information from PyPI's JSON API and identifies
versions older than a specified number of days. It can delete them using
PyPI's web interface with API token authentication.

Dependencies:
    pip install requests

Usage:
    # Dry run (default) - see what would be deleted
    python cleanup-pypi-versions.py --package moose-cli --days 80 --token $PYPI_TOKEN
    
    # Actually delete old versions
    python cleanup-pypi-versions.py --package moose-cli --days 80 --token $PYPI_TOKEN --do-it
    
    # Using environment variable
    export PYPI_TOKEN="your-pypi-token"
    python cleanup-pypi-versions.py --package moose-cli --days 80 --do-it

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
from typing import List, Tuple

import requests
from requests.auth import HTTPBasicAuth


def delete_pypi_version(
    session: requests.Session,
    package_name: str,
    version: str
) -> bool:
    """
    Delete a specific version from PyPI using the web interface.
    
    Args:
        session: Authenticated requests session (with token auth)
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
        
        if response.status_code == 403:
            print(f"    ✗ Access denied - check authentication")
            return False
        
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
    token: str,
    dry_run: bool = True
) -> bool:
    """
    Clean up old versions of a PyPI package.
    
    Args:
        package_name: Name of the PyPI package
        days_to_keep: Number of days to keep versions for
        token: PyPI API token
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
    
    # Create authenticated session with API token
    session = requests.Session()
    session.auth = HTTPBasicAuth("__token__", token)
    print("Authenticating with API token...\n")
    
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
  %(prog)s --package moose-cli --days 80 --token $PYPI_TOKEN
  
  # Actually delete old versions
  %(prog)s --package moose-cli --days 80 --token $PYPI_TOKEN --do-it
  
  # Using environment variable
  export PYPI_TOKEN="your-pypi-token"
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
        "--token",
        help="PyPI API token (can also use PYPI_TOKEN env var)"
    )
    parser.add_argument(
        "--do-it",
        action="store_true",
        help="Actually delete versions (default is dry-run)"
    )
    
    args = parser.parse_args()
    
    # Get token from args or environment
    token = args.token or os.environ.get("PYPI_TOKEN")
    
    if not token:
        print("ERROR: PyPI token required")
        print("  Use --token or PYPI_TOKEN env var")
        sys.exit(1)
    
    # Run cleanup
    success = cleanup_old_versions(
        package_name=args.package,
        days_to_keep=args.days,
        token=token,
        dry_run=not args.do_it
    )
    
    if not success:
        sys.exit(1)
    
    print("\n✓ Cleanup completed successfully")


if __name__ == "__main__":
    main()

