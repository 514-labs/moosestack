import React from "react";
import MuxPlayer from "@mux/mux-player-react";
import "@mux/mux-player/themes/minimal";

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
