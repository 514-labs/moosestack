import { render } from "@/components";

export default render({
  index: {
    display: "hidden",
    theme: {
      breadcrumb: false,
      sidebar: false,
    },
  },
  moose: {
    type: "page",
    title: "MooseStack",
    href: "/moose",
  },
  sloan: {
    type: "page",
    title: "Sloan",
    href: "/sloan",
  },
  blog: {
    title: "Blog",
    type: "page",
    href: "https://www.fiveonefour.com/blog",
    newWindow: true,
  },
  "templates-examples": {
    type: "page",
    title: "Templates / Examples",
    href: "/moose/templates-examples",
  },
  "release-notes": {
    type: "page",
    title: "Release Notes",
    href: "/release-notes",
  },
  "usage-data": {
    display: "hidden",
  },
  templates: {
    display: "hidden",
  },
});
