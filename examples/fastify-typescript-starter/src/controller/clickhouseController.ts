import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import { getEvents } from "moose";

type RecentEventsQuery = {
  limit?: string;
};

export default async function clickhouseController(fastify: FastifyInstance) {
  // GET /api/v1/clickhouse/recent?limit=10
  fastify.get(
    "/recent",
    async function (
      request: FastifyRequest<{ Querystring: RecentEventsQuery }>,
      reply: FastifyReply,
    ) {
      const limit = Math.min(
        100,
        Math.max(1, Number(request.query.limit ?? 10)),
      );

      const rows = await getEvents(limit);
      reply.send({ rows });
    },
  );
}
