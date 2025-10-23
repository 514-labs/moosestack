import fs from "fs";
import path from "path";

type SupportedLanguage = "python" | "typescript";

interface FrontMatter {
  title?: string;
  description?: string;
}

interface ParsedDocument {
  frontMatter: FrontMatter;
  body: string;
}

const DOCS_ROOT = path.join(process.cwd(), "src/pages");
const SECTION_SEPARATOR = "\n\n---\n\n";
const EXCLUDED_DIRECTORIES = new Set(["api"]);

const LANGUAGE_TAG: Record<SupportedLanguage, string> = {
  python: "Python",
  typescript: "TypeScript",
};

interface BuildLanguageDocsOptions {
  scope?: string;
  heading?: string;
}

export async function buildLanguageDocs(
  language: SupportedLanguage,
  options: BuildLanguageDocsOptions = {},
) {
  const normalizedScope = normalizeScope(options.scope);
  const initialRoot =
    normalizedScope ? path.join(DOCS_ROOT, normalizedScope) : DOCS_ROOT;

  const docHeading =
    options.heading ??
    `# ${buildScopeTitle(normalizedScope)} Documentation – ${
      LANGUAGE_TAG[language]
    }`;

  let searchRoot = initialRoot;
  let files: string[] = [];

  if (fs.existsSync(initialRoot)) {
    const stats = fs.statSync(initialRoot);

    if (stats.isDirectory()) {
      files = collectMdxFiles(initialRoot).sort();
    } else if (stats.isFile()) {
      searchRoot = path.dirname(initialRoot);
      files = [initialRoot];
    }
  } else {
    const candidateFile = `${initialRoot}.mdx`;
    if (fs.existsSync(candidateFile) && fs.statSync(candidateFile).isFile()) {
      searchRoot = path.dirname(candidateFile);
      files = [candidateFile];
    }
  }

  if (files.length === 0) {
    return docHeading;
  }

  const sections: string[] = [];
  const includedPaths: string[] = [];

  for (const filePath of files) {
    const raw = await fs.promises.readFile(filePath, "utf8");
    const { frontMatter, body } = parseFrontMatter(raw);
    const relativePath = path.relative(searchRoot, filePath);

    const filtered = filterLanguageContent(body, language);
    const cleaned = cleanContent(filtered);
    const trimmed = cleaned.trim();

    if (!trimmed) {
      continue;
    }

    const sectionLines: string[] = [];
    const heading = buildHeading(frontMatter, relativePath);
    sectionLines.push(heading);
    const sourcePath = buildSourcePath(normalizedScope, relativePath);
    includedPaths.push(sourcePath);
    sectionLines.push(`Source: ${sourcePath}`);

    if (frontMatter.description) {
      sectionLines.push(frontMatter.description.trim());
    }

    sectionLines.push(trimmed);
    sections.push(sectionLines.join("\n\n"));
  }

  const toc = buildTocSection(includedPaths);

  return [docHeading, toc, sections.join(SECTION_SEPARATOR)]
    .filter(Boolean)
    .join("\n\n");
}

function collectMdxFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith("_")) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      files.push(...collectMdxFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      files.push(fullPath);
    }
  }

  return files;
}

function parseFrontMatter(source: string): ParsedDocument {
  const frontMatterMatch = source.match(/^---\s*\n([\s\S]*?)\n---\s*/);

  if (!frontMatterMatch) {
    return { frontMatter: {}, body: source };
  }

  const [, frontMatterBlock] = frontMatterMatch;

  if (!frontMatterBlock) {
    return { frontMatter: {}, body: source };
  }
  const frontMatter: FrontMatter = {};

  for (const line of frontMatterBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const [key, ...rest] = trimmed.split(":");
    if (!key || rest.length === 0) {
      continue;
    }

    const value = rest.join(":").trim();
    if (!value) {
      continue;
    }

    if (key === "title") {
      frontMatter.title = value.replace(/^"|"$/g, "");
    } else if (key === "description") {
      frontMatter.description = value.replace(/^"|"$/g, "");
    }
  }

  const body = source.slice(frontMatterMatch[0].length);
  return { frontMatter, body };
}

function filterLanguageContent(raw: string, language: SupportedLanguage) {
  const includeTag = LANGUAGE_TAG[language];
  const excludeTag =
    LANGUAGE_TAG[language === "python" ? "typescript" : "python"];

  const excludeRegex = buildTagRegex(excludeTag);
  const includeRegex = buildTagRegex(includeTag);

  let filtered = raw.replace(excludeRegex, "");
  filtered = filtered.replace(includeRegex, (_match, inner) => inner ?? "");

  return filtered;
}

function buildTagRegex(tag: string) {
  return new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
}

function cleanContent(raw: string) {
  let content = raw;

  content = content.replace(/^\s*import [^\n]*\n/gm, "");

  content = stripExportConstBlocks(content);
  content = content.replace(/^\s*export default [^\n]*\n?/gm, "");

  content = content.replace(/\{\s*\/\*\s*.*?\s*\*\/\s*\}/gs, "");
  content = content.replace(/<>|<\/>/g, "");

  content = content.replace(/<\/?[A-Z][A-Za-z0-9]*(?:\s[^<>]*)?>/g, "");

  content = content.replace(/^[ \t]+$/gm, "");
  content = content.replace(/\n{3,}/g, "\n\n");

  return content;
}

function stripExportConstBlocks(input: string) {
  let cursor = 0;
  let result = "";

  while (cursor < input.length) {
    const exportIndex = input.indexOf("export const", cursor);

    if (exportIndex === -1) {
      result += input.slice(cursor);
      break;
    }

    result += input.slice(cursor, exportIndex);

    let braceIndex = input.indexOf("{", exportIndex);
    if (braceIndex === -1) {
      cursor = exportIndex + "export const".length;
      continue;
    }

    let depth = 1;
    let i = braceIndex + 1;

    while (i < input.length && depth > 0) {
      const char = input.charAt(i);

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
      }

      i += 1;
    }

    while (i < input.length && /[\s;,\r\n]/.test(input.charAt(i))) {
      i += 1;
    }

    cursor = i;
  }

  return result;
}

function buildHeading(frontMatter: FrontMatter, relativePath: string) {
  if (frontMatter.title) {
    return `## ${frontMatter.title}`;
  }

  const baseName = relativePath.replace(/\.mdx$/, "");
  return `## ${baseName}`;
}

function buildTocSection(paths: string[]) {
  if (paths.length === 0) {
    return undefined;
  }

  const items = paths.map((path, index) => `${index + 1}. ${path}`);
  return ["## Included Files", ...items].join("\n");
}

function normalizeScope(scope?: string) {
  if (!scope) {
    return undefined;
  }

  const parts = scope
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.some((part) => part === ".." || part.includes(".."))) {
    throw new Error(`Invalid scope path: ${scope}`);
  }

  const normalized = parts.join(path.sep);
  return normalized ? normalized : undefined;
}

function buildScopeTitle(scope?: string) {
  if (!scope) {
    return "Moose";
  }

  const segments = scope
    .split(path.sep)
    .filter(Boolean)
    .map((segment) =>
      segment.split(/[-_]/).filter(Boolean).map(capitalize).join(" "),
    );

  if (segments.length === 0) {
    return "Moose";
  }

  return segments.join(" / ");
}

function buildSourcePath(scope: string | undefined, relativePath: string) {
  const normalizedRelative = relativePath.split(path.sep).join("/");

  if (!scope) {
    return normalizedRelative;
  }

  const normalizedScope = scope.split(path.sep).join("/");
  return `${normalizedScope}/${normalizedRelative}`;
}

function capitalize(segment: string) {
  if (!segment) {
    return segment;
  }

  return segment.charAt(0).toUpperCase() + segment.slice(1);
}
