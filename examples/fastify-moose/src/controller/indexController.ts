import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { promises } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const { readFile } = promises;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const staticDir = resolve(__dirname, "../../static");

export default async function indexController(fastify: FastifyInstance) {
  // GET /
  fastify.get(
    "/",
    async function (_request: FastifyRequest, reply: FastifyReply) {
      const content = await readFile(resolve(staticDir, "index.html"));
      reply.header("Content-Type", "text/html; charset=utf-8").send(content);
    },
  );

  // GET /styles.css
  fastify.get(
    "/styles.css",
    async function (_request: FastifyRequest, reply: FastifyReply) {
      const content = await readFile(resolve(staticDir, "styles.css"));
      reply.header("Content-Type", "text/css; charset=utf-8").send(content);
    },
  );
}
