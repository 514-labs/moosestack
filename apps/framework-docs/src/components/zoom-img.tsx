"use client";

import { useState } from "react";
import Image from "next/image";

interface ZoomImageProps {
  light: string;
  dark: string;
  alt: string;
}
export function ZoomImg({ light, dark, alt }: ZoomImageProps) {
  const [isZoomed, setIsZoomed] = useState(false);

  const toggleZoom = () => {
    setIsZoomed(!isZoomed);
  };

  return (
    <div className="relative w-full">
      <Image
        src={light}
        alt={alt || "default alt"}
        width={1000}
        height={1000}
        className={`w-full h-auto transition-all duration-300 dark:hidden ${
          isZoomed ?
            "fixed inset-0 cursor-zoom-out w-screen h-screen object-contain z-50 bg-background"
          : "relative z-0 cursor-zoom-in"
        }`}
        onClick={toggleZoom}
        role="button"
        aria-expanded={isZoomed}
        aria-label={isZoomed ? "Zoom out" : "Zoom in"}
      />
      <Image
        src={dark}
        alt={alt || "default alt"}
        width={1000}
        height={1000}
        className={`w-full h-auto transition-all duration-300 hidden dark:block ${
          isZoomed ?
            "fixed inset-0 cursor-zoom-out w-screen h-screen object-contain z-50 bg-background"
          : "relative z-0 cursor-zoom-in"
        }`}
        onClick={toggleZoom}
        role="button"
        aria-expanded={isZoomed}
        aria-label={isZoomed ? "Zoom out" : "Zoom in"}
      />
      {/* {isZoomed && (
        <button
          className="fixed top-4 right-4 z-50 p-2 bg-white rounded-full shadow-lg"
          onClick={toggleZoom}
          aria-label="Close fullscreen image"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      )} */}
    </div>
  );
}
