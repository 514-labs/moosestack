"use client";

import React from "react";
import { GuideForm } from "./guide-form";
import { GuideManifest } from "@/lib/guide-types";

interface DynamicGuideBuilderProps {
  manifest: GuideManifest;
}

export function DynamicGuideBuilder({ manifest }: DynamicGuideBuilderProps) {
  return (
    <div className="w-full space-y-8">
      <GuideForm manifest={manifest} />
    </div>
  );
}
