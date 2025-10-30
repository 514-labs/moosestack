"use client";

import * as React from "react";
import Link from "next/link";
import { IconBrandGithub, IconStar } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";

export function GitHubButtonGroup() {
  const [stars, setStars] = React.useState<number | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    fetch("https://api.github.com/repos/514-labs/moose")
      .then((response) => response.json())
      .then((data) => {
        if (data && typeof data.stargazers_count === "number") {
          setStars(data.stargazers_count);
        }
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const formatStarCount = (count: number): string => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

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
      {!isLoading && stars !== null && (
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
