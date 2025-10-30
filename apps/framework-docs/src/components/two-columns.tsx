import React from "react";
import { Heading, HeadingLevel, SmallText } from "@/components/typography";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui";

interface ColumnProps {
  heading: string;
  body: string;
  list: string[];
  className: string;
}

export function Column({ heading, body, list, className }: ColumnProps) {
  return (
    <div className={cn("p-5 flex flex-col", className)}>
      <Heading level={HeadingLevel.l5} className="my-0 text-primary">
        {heading}
      </Heading>
      <SmallText className="h-1/2">{body}</SmallText>
      <ul className="text-muted-foreground">
        {list.map((listItem) => (
          <li>{listItem}</li>
        ))}
      </ul>
    </div>
  );
}

export function Columns({ children }: { children: React.ReactNode }) {
  return (
    <Card className="mt-4 md:gap-x-0">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </Card>
  );
}
