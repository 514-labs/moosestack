import type { FastifyInstance } from "fastify";
import userController from "./controller/userController.ts";
import indexController from "./controller/indexController.ts";
import clickhouseController from "./controller/clickhouseController.ts";

export default async function router(fastify: FastifyInstance) {
  fastify.register(userController, { prefix: "/api/v1/user" });
  fastify.register(clickhouseController, { prefix: "/api/v1/clickhouse" });
  fastify.register(indexController, { prefix: "/" });
}
