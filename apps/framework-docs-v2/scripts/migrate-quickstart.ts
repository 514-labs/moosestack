#!/usr/bin/env tsx

import fs from "fs";
import path from "path";

const sourceFile = path.join(
  __dirname,
  "../../framework-docs/src/pages/moose/getting-started/quickstart.mdx",
);
const targetFile = path.join(
  __dirname,
  "../content/moosestack/getting-started/quickstart.mdx",
);

const content = fs.readFileSync(sourceFile, "utf-8");

let migrated = content;

// 1. Update imports - remove Nextra components, update V2 imports
migrated = migrated.replace(
  /import \{ Tabs, Steps, Card, FileTree \} from "nextra\/components";/,
  "",
);
migrated = migrated.replace(
  /import \{ Callout, ToggleBlock, Python, TypeScript, LanguageSwitcher, MuxVideo, BulletPointsCard, IconBadge, CTACards, CTACard, PathConfig \} from "@\/components";/,
  `import { Callout, ToggleBlock, MuxVideo, BulletPointsCard, IconBadge, CTACards, CTACard, LanguageTabs, LanguageTabContent, FileTree, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/mdx";
import { PathConfig } from "@/lib/path-config";`,
);
migrated = migrated.replace(
  /import \{ CheckCircle, Clock, Laptop, Terminal \} from "lucide-react";/,
  `import { IconCheck, IconClock, IconDeviceLaptop, IconTerminal } from "@tabler/icons-react";`,
);

// 2. Remove LanguageSwitcher
migrated = migrated.replace(/<LanguageSwitcher \/>/g, "");

// 3. Replace TypeScript/Python wrappers with LanguageTabs
// This is complex - need to handle nested cases
migrated = migrated.replace(
  /<TypeScript>([\s\S]*?)<\/TypeScript>/g,
  (match, content) => {
    return `<LanguageTabs>
  <LanguageTabContent value="typescript">
${content.trim()}
  </LanguageTabContent>`;
  },
);

migrated = migrated.replace(
  /<Python>([\s\S]*?)<\/Python>/g,
  (match, content) => {
    // Check if we're closing a LanguageTabs
    if (migrated.includes("</LanguageTabContent>")) {
      return `  <LanguageTabContent value="python">
${content.trim()}
  </LanguageTabContent>
</LanguageTabs>`;
    }
    return `<LanguageTabs>
  <LanguageTabContent value="python">
${content.trim()}
  </LanguageTabContent>
</LanguageTabs>`;
  },
);

// 4. Replace Steps component (remove opening/closing tags, keep content)
migrated = migrated.replace(/<Steps>/g, "");
migrated = migrated.replace(/<\/Steps>/g, "");

// 5. Replace Nextra Tabs with V2 Tabs
migrated = migrated.replace(
  /<Tabs items=\{\["([^"]+)",\s*"([^"]+)"\]\}>/g,
  '<Tabs defaultValue="$1">\n<TabsList>\n<TabsTrigger value="$1">$1</TabsTrigger>\n<TabsTrigger value="$2">$2</TabsTrigger>\n</TabsList>',
);
migrated = migrated.replace(/<Tabs\.Tab>/g, "<TabsContent value=");
migrated = migrated.replace(/<\/Tabs\.Tab>/g, "</TabsContent>");
migrated = migrated.replace(/<\/Tabs>/g, "</Tabs>");

// 6. Update PathConfig references
migrated = migrated.replace(
  /PathConfig\.fromClickhouse\.path/g,
  "/moosestack/getting-started/from-clickhouse",
);
migrated = migrated.replace(
  /PathConfig\.fromClickhouse\.icon/g,
  "IconDatabase",
);

// 7. Update internal links
migrated = migrated.replace(
  /\[Workflow\]\(\.\.\/workflows\)/g,
  "[Workflow](/moosestack/workflows)",
);
migrated = migrated.replace(
  /\[API\]\(\.\.\/apis\)/g,
  "[API](/moosestack/apis)",
);

// 8. Replace inline TypeScript/Python
migrated = migrated.replace(
  /<TypeScript inline>`([^`]+)`<\/TypeScript>/g,
  "`$1`",
);
migrated = migrated.replace(/<Python inline>`([^`]+)`<\/Python>/g, "`$1`");

// 9. Update icon references
migrated = migrated.replace(/Icon={Clock}/g, "Icon={IconClock}");
migrated = migrated.replace(/Icon={CheckCircle}/g, "Icon={IconCheck}");
migrated = migrated.replace(/Icon={Laptop}/g, "Icon={IconDeviceLaptop}");
migrated = migrated.replace(/Icon={Terminal}/g, "Icon={IconTerminal}");

// 10. Update frontmatter
migrated = migrated.replace(
  /^---\ntitle: 5-Minute Quickstart\ndescription: Build your first analytical backend with Moose in 5 minutes\n---/,
  `---
title: 5-Minute Quickstart
description: Build your first analytical backend with Moose in 5 minutes
order: 1
category: getting-started
---`,
);

// Ensure target directory exists
const targetDir = path.dirname(targetFile);
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

fs.writeFileSync(targetFile, migrated);
console.log(`Migrated quickstart.mdx to ${targetFile}`);
