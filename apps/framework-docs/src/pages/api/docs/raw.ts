import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import fs from "fs/promises";
import { extractDecodedParam } from "@/lib/llmHelpers";

const DOCS_ROOT = path.join(process.cwd(), "src/pages");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const scope = extractDecodedParam(req.query.scope);
  const file = extractDecodedParam(req.query.file);

  try {
    const resolvedPath = await resolveDocPath({ file, scope });

    if (!resolvedPath) {
      return res.status(404).send("Document not found");
    }

    const content = await fs.readFile(resolvedPath, "utf8");
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.status(200).send(content);
  } catch (error) {
    console.error("Failed to read documentation file", error);
    res.status(500).send("Internal Server Error");
  }
}

interface ResolveOptions {
  file?: string;
  scope?: string;
}

async function resolveDocPath(options: ResolveOptions) {
  const byFile = await resolveByFile(options.file);
  if (byFile) {
    return byFile;
  }

  return resolveByScope(options.scope);
}

async function resolveByFile(file?: string) {
  if (!file) {
    return null;
  }

  const withoutPrefix = stripKnownPrefixes(file);
  const normalized = sanitizePath(withoutPrefix);
  if (!normalized) {
    return null;
  }

  const absolutePath = path.resolve(DOCS_ROOT, normalized);

  if (!absolutePath.startsWith(DOCS_ROOT)) {
    return null;
  }

  return readIfFile(absolutePath);
}

async function resolveByScope(scope?: string) {
  const normalized = sanitizePath(scope);

  const candidates = buildScopeCandidates(normalized);

  for (const candidate of candidates) {
    const absolutePath = path.resolve(DOCS_ROOT, candidate);

    if (!absolutePath.startsWith(DOCS_ROOT)) {
      continue;
    }

    const file = await readIfFile(absolutePath);
    if (file) {
      return file;
    }
  }

  return null;
}

function buildScopeCandidates(scope?: string) {
  if (!scope) {
    return ["index.mdx", "index.md"];
  }

  const scopedIndex = path.join(scope, "index");

  return [
    `${scope}.mdx`,
    `${scope}.md`,
    `${scope}.markdown`,
    `${scope}.mdoc`,
    `${scopedIndex}.mdx`,
    `${scopedIndex}.md`,
    `${scopedIndex}.markdown`,
    `${scopedIndex}.mdoc`,
  ];
}

async function readIfFile(targetPath: string) {
  try {
    const stats = await fs.stat(targetPath);

    if (stats.isFile()) {
      return targetPath;
    }
  } catch {
    // Ignore missing files
  }

  return null;
}

function sanitizePath(raw?: string) {
  if (!raw) {
    return undefined;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const withoutLeadingSlash = trimmed.replace(/^[/\\]+/, "");

  const segments = withoutLeadingSlash
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === ".." || segment === "." || segment.includes(".."),
    )
  ) {
    return undefined;
  }

  return segments.join(path.sep);
}

function stripKnownPrefixes(value: string) {
  let trimmed = value.trim();

  const prefixes = [
    "apps/framework-docs/src/pages/",
    "src/pages/",
    "pages/",
    "./",
    ".\\",
  ];

  let prefixApplied = true;

  while (prefixApplied) {
    prefixApplied = false;

    for (const prefix of prefixes) {
      if (trimmed.startsWith(prefix)) {
        trimmed = trimmed.slice(prefix.length);
        prefixApplied = true;
        break;
      }
    }
  }

  return trimmed;
}
