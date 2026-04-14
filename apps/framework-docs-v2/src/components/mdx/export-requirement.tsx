"use client";

import React from "react";
import { Callout } from "./callout";
import Link from "next/link";
import { LanguageTabs, LanguageTabContent } from "./language-tabs";

interface ExportRequirementProps {
  primitive: string;
  example?: string;
  pythonExample?: string;
}

export function ExportRequirement({
  primitive,
  example,
  pythonExample,
}: ExportRequirementProps) {
  return (
    <LanguageTabs>
      <LanguageTabContent value="typescript">
        <Callout type="info" title="Export Required" compact>
          <p>
            Moose only discovers resource definitions through your root{" "}
            <code>app/index.ts</code> barrel file. Re-export the {primitive}{" "}
            shown here from that file or Moose will not pick up those
            definitions.
          </p>
          {example && (
            <p className="mt-2">
              TypeScript example: <code className="text-sm">{example}</code>
            </p>
          )}
          <p>
            Learn more about resource discovery:{" "}
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
            Moose only discovers resource definitions that are imported from{" "}
            <code>main.py</code>. Import the module that defines the {primitive}{" "}
            shown here from <code>main.py</code> or Moose will not pick up those
            definitions.
          </p>
          {(pythonExample || example) && (
            <p className="mt-2">
              {pythonExample ? "Python example: " : "TypeScript example: "}
              <code className="text-sm">{pythonExample ?? example}</code>
            </p>
          )}
          <p>
            Learn more about resource discovery:{" "}
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
