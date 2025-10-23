import type { NextApiRequest, NextApiResponse } from "next";
import { buildLanguageDocs } from "@/lib/llmDocGenerator";

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse,
) {
  const payload = await buildLanguageDocs("python");

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");
  res.status(200).send(payload);
}
