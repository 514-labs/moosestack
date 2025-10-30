"use client";

import Link from "next/link";
import { IconBrandGithub, IconStar } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";

interface GitHubButtonGroupProps {
  stars: number | null;
}

function formatStarCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

export function GitHubButtonGroup({ stars }: GitHubButtonGroupProps) {
  return (
    <ButtonGroup>
      <Button variant="outline" size="sm" asChild className="gap-2">
        <Link
          href="https://github.com/514-labs/moose"
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconBrandGithub className="h-4 w-4" />
          <span>Source</span>
        </Link>
      </Button>
      {stars !== null && (
        <Button variant="outline" size="sm" className="gap-2" asChild>
          <Link
            href="https://github.com/514-labs/moose/stargazers"
            target="_blank"
            rel="noopener noreferrer"
          >
            <IconStar className="h-4 w-4" />
            <span>{formatStarCount(stars)}</span>
          </Link>
        </Button>
      )}
    </ButtonGroup>
  );
}
