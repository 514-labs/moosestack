import { render } from "@/components";
// Raw meta object - more concise without repetitive rendering logic
const rawMeta = {
  index: {
    title: "Release Notes",
    theme: {
      breadcrumb: false,
    },
  },
  "2025-10-24": {
    title: "October 24, 2025",
  },
  upcoming: { display: "hidden" },
};

// Process the raw meta object to generate the final meta object with proper rendering
export default render(rawMeta);
