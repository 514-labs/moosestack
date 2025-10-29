import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ArgTableRow {
  name: string;
  required?: boolean;
  description: string;
  examples?: string[];
}

export interface ArgTableProps {
  args: ArgTableRow[];
  heading?: string;
  className?: string;
}

export const ArgTable: React.FC<ArgTableProps> = ({
  args,
  heading,
  className,
}) => {
  return (
    <div className={cn("mt-6", className)}>
      {heading && (
        <h5 className="mb-3 px-1 text-sm font-semibold text-primary">
          {heading}
        </h5>
      )}
      <div className="divide-y divide-border border rounded-xl overflow-hidden">
        {args.map((arg, idx) => (
          <div
            key={arg.name + idx}
            className="flex flex-row items-start px-4 py-3 gap-4"
          >
            <div className="w-48 shrink-0 font-mono text-sm text-primary/90 pt-1">
              {arg.name}
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-primary text-sm align-middle">
                {arg.required && (
                  <span className="align-middle mr-2 inline-block">
                    <Badge variant="default">Required</Badge>
                  </span>
                )}
                {arg.description}
                {arg.examples && arg.examples.length > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    &ndash; {arg.examples.join(", ")}
                  </span>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ArgTable;
