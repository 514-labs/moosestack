import { tags } from "typia";
import { ApiUtil } from "@514labs/moose-lib/browserCompatible";
import { RepoStarEvent } from "../index.js";

export interface QueryParams {
  interval?: "minute" | "hour" | "day";
  limit?: number & tags.Minimum<1> & tags.Type<"int32">;
  exclude?: string & tags.Pattern<"^([^,]+)(,[^,]+)*$">; // comma separated list of tags to exclude
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

export async function getTopicTimeseries(
  { interval = "minute", limit = 10, exclude = "" }: QueryParams,
  { client, sql }: ApiUtil,
): Promise<ResponseBody[]> {
  const RepoTable = RepoStarEvent.table!;
  const cols = RepoTable.columns;

  const intervalMap = {
    hour: {
      select: sql.fragment`toStartOfHour(${cols.createdAt}) AS time`,
      groupBy: sql.fragment`GROUP BY time, topic`,
      orderBy: sql.fragment`ORDER BY time, totalEvents DESC`,
      limit: sql.fragment`LIMIT ${limit} BY time`,
    },
    day: {
      select: sql.fragment`toStartOfDay(${cols.createdAt}) AS time`,
      groupBy: sql.fragment`GROUP BY time, topic`,
      orderBy: sql.fragment`ORDER BY time, totalEvents DESC`,
      limit: sql.fragment`LIMIT ${limit} BY time`,
    },
    minute: {
      select: sql.fragment`toStartOfFifteenMinutes(${cols.createdAt}) AS time`,
      groupBy: sql.fragment`GROUP BY time, topic`,
      orderBy: sql.fragment`ORDER BY time, totalEvents DESC`,
      limit: sql.fragment`LIMIT ${limit} BY time`,
    },
  };

  const query = sql.statement`
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
                ${exclude ? sql.fragment`AND arrayAll(x -> x NOT IN (${exclude}), ${cols.repoTopics!})` : sql.fragment``}
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
