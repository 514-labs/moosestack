"use client";

import React from "react";
import dynamic from "next/dynamic";

// Dynamically import MuxPlayer with SSR disabled to avoid web component initialization issues
// Mux Player uses custom elements that need to be initialized in the browser
const MuxPlayer = dynamic(
  // @ts-ignore - React type version mismatch between Next.js and @mux/mux-player-react
  () => import("@mux/mux-player-react").then((mod) => mod.default),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-64 flex items-center justify-center bg-muted rounded-lg">
        <p className="text-muted-foreground">Loading video player...</p>
      </div>
    ),
  },
);

interface MuxVideoProps {
  playbackId: string;
  title?: string;
  width?: string | number;
  height?: string | number;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  className?: string;
  poster?: string;
}

export const MuxVideo: React.FC<MuxVideoProps> = ({
  playbackId,
  title = "Video",
  width = "100%",
  height = "auto",
  autoPlay = false,
  muted = false,
  loop = false,
  className = "",
  poster = "",
}) => {
  return (
    <div className="border border-border rounded-xl p-5 flex justify-center items-center">
      <MuxPlayer
        theme="minimal"
        playbackId={playbackId}
        metadataVideoTitle={title}
        primaryColor="#ffffff"
        secondaryColor="#000000"
        accentColor="#9333e9"
        autoPlay={autoPlay}
        muted={muted}
        loop={loop}
        className={className}
        poster={poster}
      />
    </div>
  );
};
