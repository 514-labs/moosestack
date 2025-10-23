import type { NextApiRequest, NextApiResponse } from "next";
import { buildLanguageDocs } from "@/lib/llmDocGenerator";
import { extractDecodedParam } from "@/lib/llmHelpers";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const scope = extractScope(req.query);
    const payload = await buildLanguageDocs("typescript", { scope });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=300");
    res.status(200).send(payload);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid scope")) {
      return res.status(400).send(error.message);
    }

    console.error("Failed to build TypeScript docs", error);
    res.status(500).send("Internal Server Error");
  }
}

function extractScope(query: NextApiRequest["query"]): string | undefined {
  const raw = query.section ?? query.scope;

  return extractDecodedParam(raw);
}
