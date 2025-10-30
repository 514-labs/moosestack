import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import fs from "fs";
import mime from "mime-types"; // We'll need to install this dependency

// Base directory where documentation files are stored
// Assuming process.cwd() is the app root (apps/framework-docs)
const docsDirectory = path.join(process.cwd(), "llm-docs");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { filePath: filePathSegments } = req.query;

  if (!filePathSegments || !Array.isArray(filePathSegments)) {
    return res.status(400).send("Invalid path");
  }

  // Construct the file path from the filePath segments
  const requestedPath = filePathSegments.join("/");
  // Construct full path relative to app root/docs
  const fullFilePath = path.join(docsDirectory, requestedPath);

  // Security check: Ensure the resolved path is still within the docs directory
  const resolvedPath = path.resolve(fullFilePath);
  if (!resolvedPath.startsWith(docsDirectory)) {
    console.warn(
      `Attempt to access forbidden path: ${requestedPath} resolved to ${resolvedPath}`,
    );
    return res.status(403).send("Forbidden");
  }

  try {
    // Check if the path exists and if it's a file
    const stats = await fs.promises.stat(fullFilePath);
    if (!stats.isFile()) {
      // Could potentially handle directory listing here if needed in the future
      return res.status(404).send("Path is not a file");
    }

    const fileContents = await fs.promises.readFile(fullFilePath, "utf8");

    // Determine content type based on file extension
    const contentType = mime.lookup(fullFilePath) || "text/plain"; // Default to text/plain

    res.setHeader("Content-Type", `${contentType}; charset=utf-8`);
    res.status(200).send(fileContents);
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.error(`File not found at path: ${fullFilePath}`);
      // Check if adding .md helps (for potentially extensionless requests)
      const mdFilePath = `${fullFilePath}.md`;
      const resolvedMdPath = path.resolve(mdFilePath);
      if (resolvedMdPath.startsWith(docsDirectory)) {
        try {
          const mdFileContents = await fs.promises.readFile(mdFilePath, "utf8");
          const mdContentType = mime.lookup(mdFilePath) || "text/markdown";
          res.setHeader("Content-Type", `${mdContentType}; charset=utf-8`);
          return res.status(200).send(mdFileContents);
        } catch (mdError: any) {
          if (mdError.code !== "ENOENT") {
            console.error("Error reading .md fallback file:", mdError);
          }
          // Fall through to 404 if .md also not found
        }
      }
      res.status(404).send("File not found");
    } else {
      console.error(`Error reading file: ${fullFilePath}`, error);
      res.status(500).send("Internal Server Error");
    }
  }
}
