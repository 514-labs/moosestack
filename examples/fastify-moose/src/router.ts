import type { FastifyInstance } from "fastify";
import indexController from "./controller/indexController.ts";
import clickhouseController from "./controller/clickhouseController.ts";

export default async function router(fastify: FastifyInstance) {
  fastify.register(clickhouseController, { prefix: "/api/v1/clickhouse" });
  fastify.register(indexController, { prefix: "/" });
}
