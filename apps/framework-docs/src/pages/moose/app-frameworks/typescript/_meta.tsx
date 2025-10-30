import { render } from "@/components";

const rawMeta = {
  index: {
    title: "Overview",
  },
  native: {
    title: "Native (Api Class)",
  },
  express: {
    title: "Express",
  },
  fastify: {
    title: "Fastify",
  },
  koa: {
    title: "Koa",
  },
  "raw-nodejs": {
    title: "Raw Node.js",
  },
};

export default render(rawMeta);
