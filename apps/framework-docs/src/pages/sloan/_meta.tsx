import { render } from "@/components";
import { HandMetal, BookMarked, History, Rocket } from "lucide-react";

const meta = {
  index: {
    title: "Introduction",
    theme: {
      breadcrumb: false,
    },
  },
  "getting-started": {
    title: "Getting Started",
    Icon: Rocket,
  },
  guides: {
    title: "Guides",
    Icon: HandMetal,
  },
  reference: {
    title: "Reference",
    Icon: BookMarked,
  },
  "data-collection-policy": {
    title: "Data collection policy",
    Icon: History,
  },
  demos: {
    title: "Demos",
    display: "hidden",
  },
} as const;

export default render(meta);
