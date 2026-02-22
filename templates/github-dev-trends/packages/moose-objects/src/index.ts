import {
  IGhEvent,
  IRepoStarEvent,
  GitHubEventType,
} from "./ingest/models.js";
import { tags } from "typia";

import {
  IngestPipeline,
  Api,
  ApiUtil,
} from "@514labs/moose-lib/browserCompatible";

export { GitHubEventType };
export type { IGhEvent, IRepoStarEvent };

// Pipeline to receive raw events from the Github API
export const GhEvent = new IngestPipeline<IGhEvent>("GhEvent", {
  ingestApi: true,
  table: true,
  stream: true,
});

// Pipeline to receive transformed events from the GhEvent pipeline
export const RepoStarEvent = new IngestPipeline<IRepoStarEvent>("RepoStar", {
  ingestApi: false,
  stream: true,
  table: true,
});

// API types
export interface QueryParams {
  interval?: "minute" | "hour" | "day";
  limit?: number & tags.Minimum<1> & tags.Type<"int32">;
  exclude?: string & tags.Pattern<"^([^,]+)(,[^,]+)*$">;
}

export interface TopicStats {
  topic: string;
  eventCount: number;
  uniqueRepos: number;
  uniqueUsers: number;
}

export interface ResponseBody {
  time: string;
  topicStats: TopicStats[];
}

// Consumption API to get a timeseries of the top `n` topics over a given interval
async function getTopicTimeseries(
  { interval = "minute", limit = 10, exclude = "" }: QueryParams,
  { client, sql }: ApiUtil,
): Promise<ResponseBody[]> {
  const RepoTable = RepoStarEvent.table!;
  const cols = RepoTable.columns;

  const intervalMap = {
    hour: {
      select: sql`toStartOfHour(${cols.createdAt}) AS time`,
      groupBy: sql`GROUP BY time, topic`,
      orderBy: sql`ORDER BY time, totalEvents DESC`,
      limit: sql`LIMIT ${limit} BY time`,
    },
    day: {
      select: sql`toStartOfDay(${cols.createdAt}) AS time`,
      groupBy: sql`GROUP BY time, topic`,
      orderBy: sql`ORDER BY time, totalEvents DESC`,
      limit: sql`LIMIT ${limit} BY time`,
    },
    minute: {
      select: sql`toStartOfFifteenMinutes(${cols.createdAt}) AS time`,
      groupBy: sql`GROUP BY time, topic`,
      orderBy: sql`ORDER BY time, totalEvents DESC`,
      limit: sql`LIMIT ${limit} BY time`,
    },
  };

  const query = sql`
            SELECT
                time,
                arrayMap(
                    (topic, events, repos, users) -> map(
                        'topic', topic,
                        'eventCount', toString(events),
                        'uniqueRepos', toString(repos),
                        'uniqueUsers', toString(users)
                    ),
                    groupArray(topic),
                    groupArray(totalEvents),
                    groupArray(uniqueReposCount),
                    groupArray(uniqueUsersCount)
                ) AS topicStats
            FROM (
                SELECT
                    ${intervalMap[interval].select},
                    arrayJoin(${cols.repoTopics!}) AS topic,
                    count() AS totalEvents,
                    uniqExact(${cols.repoId}) AS uniqueReposCount,
                    uniqExact(${cols.actorId}) AS uniqueUsersCount
                FROM ${RepoStarEvent.table!}
                WHERE length(${cols.repoTopics!}) > 0
                ${exclude ? sql`AND arrayAll(x -> x NOT IN (${exclude}), ${cols.repoTopics!})` : sql``}
                ${intervalMap[interval].groupBy}
                ${intervalMap[interval].orderBy}
                ${intervalMap[interval].limit}
            )
            GROUP BY time
            ORDER BY time;
        `;

  const resultSet = await client.query.execute<ResponseBody>(query);
  return await resultSet.json();
}

export const topicTimeseriesApi = new Api<QueryParams, ResponseBody[]>(
  "topicTimeseries",
  getTopicTimeseries,
);
