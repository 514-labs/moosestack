"use client";

import React from "react";
import { Callout } from "./callout";
import Link from "next/link";
import { LanguageTabs, LanguageTabContent } from "./language-tabs";

interface ExportRequirementProps {
  primitive: string;
  example?: string;
}

export function ExportRequirement({
  primitive,
  example,
}: ExportRequirementProps) {
  return (
    <LanguageTabs>
      <LanguageTabContent value="typescript">
        <Callout type="info" title="Export Required" compact>
          <p>
            Ensure your {primitive} is correctly exported from your{" "}
            <code>app/index.ts</code> file.
          </p>
          <p>
            Learn more about export pattern:{" "}
            <Link
              href="/moosestack/local-dev-environment?lang=typescript#hot-reloading-development"
              className="text-blue-500 hover:underline"
            >
              local development
            </Link>
            {" / "}
            <Link
              href="/moosestack/migrate?lang=typescript"
              className="text-blue-500 hover:underline"
            >
              hosted.
            </Link>
          </p>
        </Callout>
      </LanguageTabContent>
      <LanguageTabContent value="python">
        <Callout type="info" title="Export Required" compact>
          <p>
            Ensure your {primitive} is correctly imported into your{" "}
            <code>main.py</code> file.
          </p>
          <p>
            Learn more about export pattern:{" "}
            <Link
              href="/moosestack/local-dev-environment?lang=python#hot-reloading-development"
              className="text-blue-500 hover:underline"
            >
              local development
            </Link>
            {" / "}
            <Link
              href="/moosestack/migrate?lang=python"
              className="text-blue-500 hover:underline"
            >
              hosted.
            </Link>
          </p>
        </Callout>
      </LanguageTabContent>
    </LanguageTabs>
  );
}
