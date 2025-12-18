import type { FastifyInstance } from "fastify";
import userController from "./controller/userController.ts";
import indexController from "./controller/indexController.ts";

export default async function router(fastify: FastifyInstance) {
  fastify.register(userController, { prefix: "/api/v1/user" });
  fastify.register(indexController, { prefix: "/" });
}
