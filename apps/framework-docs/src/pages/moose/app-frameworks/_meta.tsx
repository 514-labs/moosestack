import { render } from "@/components";

const rawMeta = {
  index: {
    title: "Overview",
  },
  __typescript__: {
    type: "separator",
    title: "TypeScript / JavaScript / Node",
  },
  "typescript-native": {
    title: "Native (Api Class)",
  },
  "typescript-express": {
    title: "Express",
  },
  "typescript-fastify": {
    title: "Fastify",
  },
  "typescript-koa": {
    title: "Koa",
  },
  "typescript-raw-nodejs": {
    title: "Raw Node.js",
  },
  __python__: {
    type: "separator",
    title: "Python",
  },
  "python-native": {
    title: "Native (Api Class)",
  },
  "python-fastapi": {
    title: "FastAPI",
  },
};

export default render(rawMeta);
