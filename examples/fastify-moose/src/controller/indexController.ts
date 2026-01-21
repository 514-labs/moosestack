import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { promises } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const { readFile } = promises;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const staticDir = resolve(__dirname, "../../static");

let indexHtmlContent: Buffer | null = null;
let stylesCssContent: Buffer | null = null;

export default async function indexController(fastify: FastifyInstance) {
  // Cache static files at startup
  if (!indexHtmlContent) {
    indexHtmlContent = await readFile(resolve(staticDir, "index.html"));
  }
  if (!stylesCssContent) {
    stylesCssContent = await readFile(resolve(staticDir, "styles.css"));
  }

  // GET /
  fastify.get(
    "/",
    async function (_request: FastifyRequest, reply: FastifyReply) {
      reply
        .header("Content-Type", "text/html; charset=utf-8")
        .send(indexHtmlContent);
    },
  );

  // GET /styles.css
  fastify.get(
    "/styles.css",
    async function (_request: FastifyRequest, reply: FastifyReply) {
      reply
        .header("Content-Type", "text/css; charset=utf-8")
        .send(stylesCssContent);
    },
  );
}
