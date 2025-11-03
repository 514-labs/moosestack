import { render } from "@/components";

const rawMeta = {
  index: {
    title: "Overview",
  },
  __typescript__: {
    type: "separator",
    title: "Typescript / Javascript / Node",
  },
  "typescript-native": {
    title: "Native (Api Class)",
  },
  express: {
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
  fastapi: {
    title: "FastAPI",
  },
};

export default render(rawMeta);
