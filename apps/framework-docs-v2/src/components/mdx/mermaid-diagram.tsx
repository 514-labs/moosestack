"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { IconCopy, IconCheck, IconZoomIn, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

interface MermaidDiagramProps {
  code: string;
  filename?: string;
  className?: string;
  maxHeight?: string;
}

export function MermaidDiagram({
  code,
  filename,
  className,
  maxHeight,
}: MermaidDiagramProps) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [svgContent, setSvgContent] = useState<string>("");
  const [isZoomed, setIsZoomed] = useState(false);
  const [copied, setCopied] = useState(false);
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const svgRef = useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy mermaid code:", error);
    }
  };

  // Ensure component is mounted before rendering (avoids hydration mismatch)
  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle Escape key to close zoom modal
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isZoomed) {
        setIsZoomed(false);
      }
    };

    if (isZoomed) {
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [isZoomed]);

  useEffect(() => {
    if (!mounted) return;

    let cancelled = false;

    const renderDiagram = async () => {
      try {
        setIsLoading(true);
        setError(null);
        setSvgContent("");

        // Dynamic import to lazy load mermaid
        const mermaid = (await import("mermaid")).default;

        // Configure mermaid theme based on current theme
        const isDark = resolvedTheme === "dark";

        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            // Theme colors matching shadcn design
            // primaryColor = node/shape fill color
            // primaryTextColor = text inside nodes
            primaryColor: isDark ? "hsl(0, 0%, 14.9%)" : "hsl(0, 0%, 96.1%)",
            primaryTextColor: isDark ? "hsl(0, 0%, 98%)" : "hsl(0, 0%, 9%)",
            primaryBorderColor:
              isDark ? "hsl(0, 0%, 27%)" : "hsl(0, 0%, 89.8%)",
            lineColor: isDark ? "hsl(0, 0%, 63.9%)" : "hsl(0, 0%, 45.1%)",
            secondaryColor: isDark ? "hsl(0, 0%, 10%)" : "hsl(0, 0%, 98%)",
            tertiaryColor: isDark ? "hsl(0, 0%, 20%)" : "hsl(0, 0%, 95%)",
            background: isDark ? "hsl(0, 0%, 0%)" : "hsl(0, 0%, 100%)",
            mainBkg: isDark ? "hsl(0, 0%, 14.9%)" : "hsl(0, 0%, 96.1%)",
            secondBkg: isDark ? "hsl(0, 0%, 10%)" : "hsl(0, 0%, 98%)",
            border1: isDark ? "hsl(0, 0%, 27%)" : "hsl(0, 0%, 89.8%)",
            border2: isDark ? "hsl(0, 0%, 27%)" : "hsl(0, 0%, 85%)",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            fontSize: "16px",
          },
          flowchart: {
            curve: "basis",
            padding: 20,
            nodeSpacing: 80,
            rankSpacing: 80,
          },
          sequence: {
            diagramMarginX: 20,
            diagramMarginY: 20,
            actorMargin: 80,
            width: 200,
            height: 65,
            boxMargin: 15,
            messageMargin: 50,
            boxTextMargin: 8,
          },
          gantt: {
            titleTopMargin: 25,
            barHeight: 30,
            barGap: 8,
            topPadding: 75,
            leftPadding: 120,
            gridLineStartPadding: 35,
            fontSize: 14,
          },
          gitGraph: {
            mainBranchName: "main",
            mainBranchOrder: 0,
          },
        });

        // Generate unique ID for this diagram
        const id = `mermaid-${Math.random().toString(36).slice(2, 11)}`;

        if (cancelled) return;

        // Render diagram
        const { svg } = await mermaid.render(id, code);

        if (cancelled) return;

        // Store SVG content in state for React to render
        setSvgContent(svg);
        setIsLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("Mermaid rendering error:", err);
        setError(
          err instanceof Error ? err.message : "Failed to render diagram",
        );
        setIsLoading(false);
      }
    };

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [code, resolvedTheme, mounted]);

  // Scale SVG to fit maxHeight constraint
  useEffect(() => {
    if (!maxHeight || !svgRef.current || !svgContent) return;

    const svg = svgRef.current.querySelector("svg");
    if (!svg) return;

    // Get the SVG's natural dimensions from viewBox
    const viewBox = svg.getAttribute("viewBox");
    if (!viewBox) return;

    const [, , viewBoxWidth, viewBoxHeight] = viewBox.split(" ").map(Number);
    if (!viewBoxWidth || !viewBoxHeight) return;

    // Parse maxHeight (remove "px" suffix)
    const maxHeightPx = parseInt(maxHeight);
    if (isNaN(maxHeightPx)) return;

    // Account for padding (16px on each side = 32px total)
    const availableHeight = maxHeightPx - 32;

    // Calculate scale to fit height
    const scale = Math.min(1, availableHeight / viewBoxHeight);

    // Calculate scaled dimensions
    const scaledWidth = viewBoxWidth * scale;
    const scaledHeight = viewBoxHeight * scale;

    // Remove width attribute and set actual dimensions to scaled size
    // SVG with viewBox will scale content to fit these dimensions
    svg.removeAttribute("width");
    svg.style.width = `${scaledWidth}px`;
    svg.style.height = `${scaledHeight}px`;
  }, [maxHeight, svgContent, isZoomed]);

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div
        className={cn(
          "relative my-4 rounded-lg border bg-muted/50 overflow-hidden w-full",
          className,
        )}
      >
        {filename && (
          <div className="border-b border-border/75 bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
            {filename}
          </div>
        )}
        <div className="bg-muted/30 rounded-b-lg p-8">
          <div className="flex items-center justify-center min-h-[200px]">
            <div className="text-muted-foreground">Loading diagram...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "relative my-4 rounded-lg border border-destructive/50 bg-destructive/10 overflow-hidden w-full",
          className,
        )}
      >
        {filename && (
          <div className="border-b border-destructive/50 bg-destructive/20 px-4 py-2 text-sm text-destructive-foreground">
            {filename}
          </div>
        )}
        <div className="p-4">
          <div className="text-sm font-mono text-destructive">
            <div className="font-bold mb-2">Mermaid Diagram Error:</div>
            <pre className="whitespace-pre-wrap">{error}</pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "relative my-4 rounded-lg border bg-muted/50 overflow-hidden w-full group",
          className,
        )}
      >
        {filename && (
          <div className="border-b border-border/75 bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
            {filename}
          </div>
        )}
        <div
          className={cn(
            "bg-muted/30 rounded-b-lg overflow-auto min-w-0 max-w-full",
          )}
          style={maxHeight ? { maxHeight } : undefined}
        >
          <div
            className={cn(
              "mermaid-container relative",
              maxHeight ? "p-4 h-full" : "p-8",
              maxHeight && "mermaid-container-constrained",
              isLoading && "min-h-[200px] flex items-center justify-center",
            )}
            role="img"
            aria-label={filename || "Mermaid diagram"}
          >
            {isLoading ?
              <div className="text-muted-foreground">Rendering diagram...</div>
            : <>
                <div
                  ref={svgRef}
                  className={maxHeight ? "mermaid-svg-wrapper" : undefined}
                  dangerouslySetInnerHTML={{ __html: svgContent }}
                />
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                  <Button
                    className="h-7 w-7"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopy();
                    }}
                    size="icon"
                    variant="ghost"
                    title="Copy mermaid code"
                  >
                    {copied ?
                      <IconCheck className="h-3 w-3" />
                    : <IconCopy className="h-3 w-3" />}
                    <span className="sr-only">Copy mermaid code</span>
                  </Button>
                  <Button
                    className="h-7 w-7"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsZoomed(true);
                    }}
                    size="icon"
                    variant="ghost"
                    title="Zoom diagram"
                  >
                    <IconZoomIn className="h-3 w-3" />
                    <span className="sr-only">Zoom diagram</span>
                  </Button>
                </div>
              </>
            }
          </div>
        </div>
      </div>

      {/* Zoom Modal */}
      {isZoomed && (
        <div
          className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-8"
          onClick={() => setIsZoomed(false)}
        >
          <div
            className="relative w-full h-full flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsZoomed(false)}
              className="absolute top-4 right-4 z-10 bg-background/90 hover:bg-background rounded-full p-3 border border-border transition-colors shadow-lg"
              aria-label="Close zoom"
            >
              <IconX className="h-6 w-6" />
            </button>
            <div className="overflow-auto max-w-full max-h-full bg-muted/30 rounded-lg border border-border p-8">
              <div
                className="mermaid-container-zoomed"
                dangerouslySetInnerHTML={{ __html: svgContent }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
