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
  "2025-07-03": {
    title: "July 3, 2025",
  },
  "2025-05-30": {
    title: "May 30, 2025",
  },
  "2025-05-23": {
    title: "May 23, 2025",
  },
  "2025-05-19": {
    title: "May 19, 2025",
  },
  "2025-05-16": {
    title: "May 16, 2025",
  },
  upcoming: { display: "hidden" },
};

// Process the raw meta object to generate the final meta object with proper rendering
export default render(rawMeta);
