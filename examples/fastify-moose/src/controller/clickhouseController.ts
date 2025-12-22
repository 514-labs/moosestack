import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import { getEvents } from "moose";

interface RecentEventsQuery {
  limit?: string;
}

export default async function clickhouseController(fastify: FastifyInstance) {
  // GET /api/v1/clickhouse/recent?limit=10
  fastify.get(
    "/recent",
    async function (
      request: FastifyRequest<{ Querystring: RecentEventsQuery }>,
      reply: FastifyReply,
    ) {
      const parsedLimit = Number.parseInt(
        String(request.query.limit ?? ""),
        10,
      );
      const limit = Math.min(
        100,
        Math.max(1, Number.isNaN(parsedLimit) ? 10 : parsedLimit),
      );

      try {
        const rows = await getEvents(limit);
        reply.send({ rows });
      } catch (error) {
        request.log.error(
          { err: error, limit },
          "Failed to fetch events from ClickHouse",
        );
        reply.code(500).send({ error: "Failed to fetch events" });
      }
    },
  );
}
