import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import { getEventsQuery, BadRequestError } from "moose";

export default async function clickhouseController(fastify: FastifyInstance) {
  // GET /api/v1/clickhouse/events
  // Query: ?minAmount=100&maxAmount=1000&status=active&limit=20&offset=0
  fastify.get(
    "/events",
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        const rows = await getEventsQuery.fromUrl(request.url);
        reply.send({ rows, count: rows.length });
      } catch (err: unknown) {
        if (err instanceof BadRequestError) {
          return reply.code(400).send(err.toJSON());
        }
        const message = err instanceof Error ? err.message : "Unknown error";
        request.log.error({ err }, "Query failed");
        reply.code(500).send({ error: message });
      }
    },
  );
}
