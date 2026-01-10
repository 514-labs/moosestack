import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import {
  getEvents,
  getEventsRequest,
  getEventsValidated,
  ValidationError,
} from "moose";

export default async function clickhouseController(fastify: FastifyInstance) {
  // GET /api/v1/clickhouse/events
  // Query: ?minAmount=100&maxAmount=1000&status=active&limit=20&offset=0
  fastify.get(
    "/events",
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        const params = getEventsRequest(request.query as string);
        const rows = await getEventsValidated(params);
        reply.send({ rows, count: rows.length });
      } catch (err) {
        if (err instanceof ValidationError) {
          reply.code(400).send({
            error: "Validation failed",
            details: err.errors,
          });
          return;
        }

        if (err instanceof Error) {
          request.log.error({ err }, "Query failed");
          reply.code(500).send({ error: err.message });
        } else {
          reply.code(500).send({ error: "Unknown error" });
        }
      }
    },
  );
}
