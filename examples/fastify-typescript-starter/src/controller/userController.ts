import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export default async function userController(fastify: FastifyInstance) {
  // GET /api/v1/user
  fastify.get(
    "/",
    async function (_request: FastifyRequest, reply: FastifyReply) {
      reply.send({
        balance: "$3,277.32",
        picture: "http://placehold.it/32x32",
        age: 30,
        name: "Leonor Cross",
        gender: "female",
        company: "GRONK",
        email: "leonorcross@gronk.com",
      });
    },
  );
}
