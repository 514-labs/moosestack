"use client";

import * as React from "react";
import { TemplateGrid } from "./template-grid";
import type { ItemMetadata } from "@/lib/template-types";

export function TemplatesGridServer() {
  const [items, setItems] = React.useState<ItemMetadata[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/templates")
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to fetch templates");
        }
        return res.json();
      })
      .then((data) => {
        setItems(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error fetching templates:", err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>Loading templates...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium mb-2">Error loading templates</p>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return <TemplateGrid items={items} />;
}
