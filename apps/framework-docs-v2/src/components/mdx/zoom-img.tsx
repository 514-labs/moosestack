"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface ZoomImgProps {
  light: string;
  dark: string;
  alt: string;
  className?: string;
}

export function ZoomImg({ light, dark, alt, className }: ZoomImgProps) {
  const [isZoomed, setIsZoomed] = useState(false);

  const toggleZoom = () => {
    setIsZoomed(!isZoomed);
  };

  return (
    <div className={cn("relative w-full my-4", className)}>
      <Image
        src={light}
        alt={alt || "Image"}
        width={1000}
        height={1000}
        className={cn(
          "w-full h-auto transition-all duration-300 dark:hidden",
          isZoomed ?
            "fixed inset-0 cursor-zoom-out w-screen h-screen object-contain z-50 bg-background"
          : "relative z-0 cursor-zoom-in rounded-lg",
        )}
        onClick={toggleZoom}
        role="button"
        aria-expanded={isZoomed}
        aria-label={isZoomed ? "Zoom out" : "Zoom in"}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleZoom();
          }
        }}
      />
      <Image
        src={dark}
        alt={alt || "Image"}
        width={1000}
        height={1000}
        className={cn(
          "w-full h-auto transition-all duration-300 hidden dark:block",
          isZoomed ?
            "fixed inset-0 cursor-zoom-out w-screen h-screen object-contain z-50 bg-background"
          : "relative z-0 cursor-zoom-in rounded-lg",
        )}
        onClick={toggleZoom}
        role="button"
        aria-expanded={isZoomed}
        aria-label={isZoomed ? "Zoom out" : "Zoom in"}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleZoom();
          }
        }}
      />
    </div>
  );
}
