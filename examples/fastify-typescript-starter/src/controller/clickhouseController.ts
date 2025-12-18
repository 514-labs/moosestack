import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getMooseClients, sql } from "@514labs/moose-lib";

import { Events, type EventModel } from "moose";

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

      // Local dev defaults (matches moose/moose.config.toml)
      const { client } = await getMooseClients({
        host: "localhost",
        port: "18123",
        username: "panda",
        password: "pandapass",
        database: "local",
        useSSL: false,
      });

      const result = await client.query.execute<EventModel>(
        sql`SELECT * FROM ${Events} ORDER BY ${Events.columns.event_time} DESC LIMIT ${limit}`,
      );

      const rows = (await result.json()) as EventModel[];
      reply.send({ rows });
    },
  );
}
