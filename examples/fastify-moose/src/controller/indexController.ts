import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { promises } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const { readFile } = promises;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default async function indexController(fastify: FastifyInstance) {
  // GET /
  fastify.get(
    "/",
    async function (_request: FastifyRequest, reply: FastifyReply) {
      const indexHtmlPath = resolve(__dirname, "../../static/index.html");
      const indexHtmlContent = await readFile(indexHtmlPath);
      reply
        .header("Content-Type", "text/html; charset=utf-8")
        .send(indexHtmlContent);
    },
  );
}
