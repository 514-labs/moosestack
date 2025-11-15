import { Fragment } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DocBreadcrumbItem } from "@/lib/breadcrumbs";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface DocBreadcrumbsProps {
  items: DocBreadcrumbItem[];
  className?: string;
}

export function DocBreadcrumbs({ items, className }: DocBreadcrumbsProps) {
  if (!items.length) {
    return null;
  }

  return (
    <Breadcrumb className={cn("text-sm text-muted-foreground", className)}>
      <BreadcrumbList>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const key = `${item.label}-${index}`;

          return (
            <Fragment key={key}>
              <BreadcrumbItem>
                {isLast ?
                  <BreadcrumbPage>{item.label}</BreadcrumbPage>
                : item.href ?
                  <BreadcrumbLink asChild>
                    <Link href={item.href}>{item.label}</Link>
                  </BreadcrumbLink>
                : <span className="font-medium">{item.label}</span>}
              </BreadcrumbItem>
              {!isLast ?
                <BreadcrumbSeparator />
              : null}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
