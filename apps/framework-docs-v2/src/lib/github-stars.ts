import { unstable_cache } from "next/cache";

/**
 * Fetches the GitHub star count for the 514-labs/moose repository.
 * Uses Next.js unstable_cache to ensure only one API call during build,
 * even when multiple pages are generated in parallel.
 */
async function fetchGitHubStars(): Promise<number | null> {
  try {
    const response = await fetch(
      "https://api.github.com/repos/514-labs/moose",
      {
        headers: {
          // GitHub API requires a user-agent
          "User-Agent": "MooseDocs",
          // Optional: Add Authorization header with token to increase rate limit
          // Authorization: `token ${process.env.GITHUB_TOKEN}`,
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

/**
 * Cached version that ensures only one API call during build.
 * Cache is shared across all page generations.
 */
export const getGitHubStars = unstable_cache(
  async () => fetchGitHubStars(),
  ["github-stars"],
  {
    revalidate: 3600, // Cache for 1 hour
    tags: ["github-stars"],
  },
);
