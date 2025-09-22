import React from "react";
import { Callout } from "./callout";
import Link from "next/link";
import { TypeScript, Python } from "./language-wrappers";

interface ExportRequirementProps {
  primitive: string;
  example?: string;
}

export function ExportRequirement({
  primitive,
  example,
}: ExportRequirementProps) {
  return (
    <Callout type="info" title="Export Required" compact>
      <TypeScript>
        <p>
          Ensure your {primitive} is correctly exported from your{" "}
          <code>app/index.ts</code> file.
        </p>
      </TypeScript>
      <Python>
        <p>
          Ensure your {primitive} is correctly imported into your{" "}
          <code>main.py</code> file.
        </p>
      </Python>
      <p>
        Learn more about export pattern:{" "}
        <Link
          href="/moose/local-dev#hot-reloading-development"
          className="text-blue-500 hover:underline"
        >
          local development
        </Link>
        {" / "}
        <Link href="/moose/migrate" className="text-blue-500 hover:underline">
          hosted.
        </Link>
      </p>
    </Callout>
  );
}
