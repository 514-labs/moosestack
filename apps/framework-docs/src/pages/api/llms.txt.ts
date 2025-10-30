import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import fs from "fs";

// Try resolving relative to process.cwd() assuming it's the app root (apps/framework-docs)
const filePath = path.join(process.cwd(), "llm-docs", "llms.txt");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const fileContents = await fs.promises.readFile(filePath, "utf8");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(fileContents);
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.error(`File not found at path: ${filePath}`);
      res.status(404).send("File not found");
    } else {
      console.error("Error reading file:", error);
      res.status(500).send("Internal Server Error");
    }
  }
}
