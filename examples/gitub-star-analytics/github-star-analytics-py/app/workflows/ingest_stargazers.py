import os
import requests
from datetime import datetime, timedelta
from dotenv import load_dotenv
from pathlib import Path
from typing import Optional, Dict, List


class StargazerIngester:
    def __init__(self, owner: str, repo: str, token: str, base_url: str):
        self.owner = owner
        self.repo = repo
        self.token = token
        self.base_url = base_url
        self.headers = {
            "Accept": "application/vnd.github.v3.star+json",
            "Authorization": f"token {token}",
        }

    def fetch_stargazers(self, before_date: Optional[datetime] = None) -> List[Dict]:
        """Fetch all stargazers before a given date"""
        stargazers = []
        page = 1
        per_page = 100

        while True:
            url = f"https://api.github.com/repos/{self.owner}/{self.repo}/stargazers"
            params = {"per_page": per_page, "page": page}

            response = requests.get(url, headers=self.headers, params=params)
            if response.status_code != 200:
                print(
                    f"Error fetching stargazers: {response.status_code} {response.reason}"
                )
                break

            data = response.json()
            if not data:
                break

            # Filter by date if specified
            if before_date:
                data = [
                    star
                    for star in data
                    if datetime.strptime(star["starred_at"], "%Y-%m-%dT%H:%M:%SZ")
                    < before_date
                ]
                if not data:  # Stop if we've passed our date threshold
                    break

            stargazers.extend(data)
            page += 1

        return stargazers

    def ingest_stargazers(self, stargazers: List[Dict]) -> int:
        """Ingest stargazers into the system"""
        stargazer_data = [
            {
                "starred_at": stargazer["starred_at"],
                "login": stargazer["user"]["login"],
                "avatar_url": stargazer["user"]["avatar_url"],
                "repos_url": stargazer["user"]["repos_url"],
            }
            for stargazer in stargazers
        ]

        response = requests.post(
            f"{self.base_url}/ingest/HistoricalStargazer", json=stargazer_data
        )
        if response.ok:
            print(f"Ingested {len(stargazers)} stargazers")
        else:
            print(
                f"Failed to ingest {len(stargazers)} stargazers: {response.status_code}"
            )

        return len(stargazers)


def get_ingest_url(env: str) -> str:
    """Determine the ingest URL based on environment"""
    if env == "production":
        return "https://your-production-url.com"
    return "http://localhost:4000"


def main():
    # Setup
    load_dotenv()

    # Configuration
    token = os.getenv("GITHUB_ACCESS_TOKEN")
    owner = os.getenv("GITHUB_OWNER", "514-labs")
    repo = os.getenv("GITHUB_REPO", "moose")
    base_url = os.getenv("MOOSE_API_HOST")

    if not token:
        raise ValueError("Please set the GITHUB_ACCESS_TOKEN environment variable.")

    ingester = StargazerIngester(owner, repo, token, base_url)

    # Set cutoff date (default to yesterday evening)
    cutoff_date = datetime.utcnow().replace(
        hour=18, minute=0, second=0, microsecond=0
    ) - timedelta(days=1)

    # Fetch and ingest
    stargazers = ingester.fetch_stargazers(before_date=cutoff_date)
    total_ingested = ingester.ingest_stargazers(stargazers)

    print(f"\nCompleted: Ingested {total_ingested} stargazers")


if __name__ == "__main__":
    main()
