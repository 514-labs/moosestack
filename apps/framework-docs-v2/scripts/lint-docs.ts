#!/usr/bin/env tsx

import crypto from "crypto";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

type Issue = {
  file: string;
  code: string;
  message: string;
  line?: number;
};

const CONTENT_ROOT = path.join(__dirname, "../content");

const BANNED_PHRASES: Array<{ phrase: string; message: string }> = [
  { phrase: "pre-requisites", message: 'Use "prerequisites".' },
];

const LEGACY_PATTERNS: Array<{ regex: RegExp; message: string }> = [
  {
    regex: /docs\.fiveonefour\.com\/moose(\/|$)/g,
    message: "Legacy docs base URL (use /moosestack).",
  },
  {
    regex: /github\.com\/514-labs\/moose(\/|$)/g,
    message: "Legacy GitHub repo link (use 514-labs/moosestack).",
  },
  {
    // Only flag internal links, not filesystem paths like `/moose/dist`.
    regex: /\]\(\/moose(\/|$|#|\?)/g,
    message: "Legacy internal docs link (use /moosestack).",
  },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!fullPath.endsWith(".md") && !fullPath.endsWith(".mdx")) continue;
    out.push(fullPath);
  }
  return out;
}

function countH1Lines(markdown: string): number {
  const lines = markdown.split("\n");
  let inFence = false;
  let count = 0;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.startsWith("# ")) count += 1;
  }

  return count;
}

function normalizeForDuplicateDetection(markdown: string): string {
  const lines = markdown.split("\n");
  const filtered = lines
    .filter((l) => !l.trimStart().startsWith("import "))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
  return filtered;
}

async function main() {
  const failOnIssues = process.argv.includes("--fail");

  const files = walk(CONTENT_ROOT);
  const issues: Issue[] = [];

  const normalizedByHash = new Map<string, string[]>();

  for (const fullPath of files) {
    const rel = path.relative(CONTENT_ROOT, fullPath);
    const raw = fs.readFileSync(fullPath, "utf8");

    const isSharedFragment = rel.startsWith(`shared${path.sep}`);
    const parsed = matter(raw);

    // Metadata checks (skip shared fragments; they often intentionally omit frontmatter)
    if (!isSharedFragment) {
      const title = parsed.data?.title;
      const description = parsed.data?.description;

      if (!title) {
        issues.push({
          file: rel,
          code: "frontmatter/missing-title",
          message: "Missing frontmatter `title`.",
        });
      }

      if (!description) {
        issues.push({
          file: rel,
          code: "frontmatter/missing-description",
          message: "Missing frontmatter `description`.",
        });
      }

      const h1Count = countH1Lines(parsed.content);
      if (h1Count > 1) {
        issues.push({
          file: rel,
          code: "structure/multiple-h1",
          message: `Multiple H1 headings found (${h1Count}). Prefer a single H1 per page.`,
        });
      }
    }

    // Banned phrases + legacy links (scan full raw content)
    for (const { phrase, message } of BANNED_PHRASES) {
      const idx = raw.toLowerCase().indexOf(phrase.toLowerCase());
      if (idx !== -1) {
        const line = raw.slice(0, idx).split("\n").length;
        issues.push({
          file: rel,
          code: "copy/banned-phrase",
          message: `${message} Found: "${phrase}".`,
          line,
        });
      }
    }

    for (const { regex, message } of LEGACY_PATTERNS) {
      const match = raw.match(regex);
      if (match?.length) {
        issues.push({
          file: rel,
          code: "links/legacy",
          message: `${message} (${match.length} occurrence${match.length === 1 ? "" : "s"}).`,
        });
      }
    }

    // Duplicate content heuristic (only for non-shared pages)
    if (!isSharedFragment) {
      const normalized = normalizeForDuplicateDetection(parsed.content);
      if (normalized.length > 0) {
        const hash = crypto
          .createHash("sha256")
          .update(normalized)
          .digest("hex");
        const list = normalizedByHash.get(hash) ?? [];
        list.push(rel);
        normalizedByHash.set(hash, list);
      }
    }
  }

  for (const [hash, paths] of normalizedByHash.entries()) {
    if (paths.length <= 1) continue;
    issues.push({
      file: paths[0]!,
      code: "content/duplicate",
      message: `Duplicate body detected (${paths.length} files): ${paths.join(", ")}`,
    });
  }

  console.log(`Docs lint: scanned ${files.length} files`);

  if (issues.length === 0) {
    console.log("Docs lint: no issues found");
    return;
  }

  console.log(`Docs lint: found ${issues.length} issue(s)\n`);

  // Group by file for readability
  const byFile = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = byFile.get(issue.file) ?? [];
    list.push(issue);
    byFile.set(issue.file, list);
  }

  for (const [file, fileIssues] of byFile.entries()) {
    console.log(file);
    for (const issue of fileIssues) {
      const line = issue.line ? `:${issue.line}` : "";
      console.log(`  - ${issue.code}${line}: ${issue.message}`);
    }
    console.log("");
  }

  if (failOnIssues) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Docs lint failed:", error);
  process.exit(1);
});
