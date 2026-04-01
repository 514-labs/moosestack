import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { parseSemanticToolPayload } from "../src/features/chat/renderers/tools/semantic-tool-payload";
import type { ToolPart } from "../src/features/chat/types/message-parts";

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children),
}));

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  CollapsibleContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | undefined | null | false>) =>
    classes.filter(Boolean).join(" "),
}));

describe("SemanticToolInvocationContent", () => {
  it("renders metric results in a readable table view", async () => {
    const { SemanticToolInvocationContent } = await import(
      "../src/features/chat/renderers/tools/semantic-tool-invocation"
    );
    const part: ToolPart = {
      type: "tool-query_tenant_knowledge_metrics",
      toolCallId: "call-1",
      toolName: "query_tenant_knowledge_metrics",
      state: "output-available",
      input: {
        metrics: ["totalRecords"],
        dimensions: ["category"],
        limit: 10,
      },
      output: {
        structuredContent: {
          toolName: "query_tenant_knowledge_metrics",
          kind: "metrics",
          rows: [{ category: "incident", totalRecords: 3 }],
          rowCount: 1,
        },
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(SemanticToolInvocationContent, {
        part,
        payload: parseSemanticToolPayload(part.toolName, part.output),
      }),
    );

    expect(html).toContain("Metrics");
    expect(html).toContain("Group By");
    expect(html).toContain("incident");
    expect(html).toContain("totalRecords");
  });

  it("renders record results as cards", async () => {
    const { SemanticToolInvocationContent } = await import(
      "../src/features/chat/renderers/tools/semantic-tool-invocation"
    );
    const part: ToolPart = {
      type: "tool-list_tenant_knowledge_records",
      toolCallId: "call-2",
      toolName: "list_tenant_knowledge_records",
      state: "output-available",
      input: {
        priority_in: ["high"],
      },
      output: {
        structuredContent: {
          toolName: "list_tenant_knowledge_records",
          kind: "records",
          rows: [
            {
              recordId: "rec-1",
              headline: "Shipment delayed",
              category: "operations",
              priority: "high",
              source: "jira",
              timestamp: "2026-03-31T12:00:00Z",
              details: "Port closure is impacting the inbound route.",
            },
          ],
          rowCount: 1,
        },
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(SemanticToolInvocationContent, {
        part,
        payload: parseSemanticToolPayload(part.toolName, part.output),
      }),
    );

    expect(html).toContain("Shipment delayed");
    expect(html).toContain("priority: high");
    expect(html).toContain("Port closure is impacting the inbound route.");
  });
});
