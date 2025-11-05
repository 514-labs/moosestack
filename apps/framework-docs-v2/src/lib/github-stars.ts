/**
 * Fetches the GitHub star count for the 514-labs/moose repository.
 * Uses Next.js fetch cache with 1 hour revalidation to minimize API calls.
 */
export async function getGitHubStars(): Promise<number | null> {
  try {
    const response = await fetch(
      "https://api.github.com/repos/514-labs/moose",
      {
        next: {
          // Cache for 1 hour (3600 seconds)
          revalidate: 3600,
        },
        headers: {
          // GitHub API requires a user-agent
          "User-Agent": "MooseDocs",
        },
      },
    );

    if (!response.ok) {
      console.error(
        `Failed to fetch GitHub stars: ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const data = await response.json();
    if (data && typeof data.stargazers_count === "number") {
      return data.stargazers_count;
    }

    return null;
  } catch (error) {
    console.error("Error fetching GitHub stars:", error);
    return null;
  }
}
