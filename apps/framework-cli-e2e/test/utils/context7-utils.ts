/**
 * Context7 API utilities for searching MooseStack documentation.
 *
 * Context7 is a doc mcp that allows AI agents to find relevant documentation dynamically.
 */

/**
 * Search MooseStack documentation using the Context7 API.
 */
export async function searchMooseDocs(
  query: string,
  apiKey?: string,
): Promise<
  { success: true; content: string } | { success: false; error: string }
> {
  const key = apiKey || process.env.CONTEXT7_API_KEY;

  if (!key) {
    return {
      success: false,
      error: "CONTEXT7_API_KEY not set",
    };
  }

  try {
    // Context7 API: https://context7.com/docs/api-guide
    const params = new URLSearchParams({
      libraryId: "/514-labs/moosestack",
      query: query,
    });

    const response = await fetch(
      `https://context7.com/api/v2/context?${params}`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
        },
        signal: AbortSignal.timeout(30000),
      },
    );

    if (response.ok) {
      const content = await response.text();
      return {
        success: true,
        content,
      };
    } else {
      const errorText = await response.text();
      return {
        success: false,
        error: `Context7 API error: ${response.status} - ${errorText}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to search docs: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
