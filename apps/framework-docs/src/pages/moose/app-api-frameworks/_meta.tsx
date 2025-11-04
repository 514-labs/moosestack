import { render } from "@/components";

const rawMeta = {
  index: {
    title: "Overview",
  },
  __typescript__: {
    type: "separator",
    title: "Typescript / Javascript / Node",
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
  "typescript-native": {
    title: "Native Moose APIs",
  },
  __python__: {
    type: "separator",
    title: "Python",
  },
  fastapi: {
    title: "FastAPI",
  },
  "python-native": {
    title: "Native Moose APIs",
  },
};

export default render(rawMeta);
