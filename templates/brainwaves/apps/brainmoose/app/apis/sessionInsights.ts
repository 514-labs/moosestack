import { Api } from "@514labs/moose-lib";

// This file is where you can define your API templates for consuming your data
// All query_params are passed in as strings, and are used within the sql tag to parameterize you queries
interface QueryParams {
  sessions: string; // sessionId|sessionLabel, sessionId|sessionLabel, ...
}

interface SessionInsightResponse {
  status: number;
  success: boolean;
  data: {
    queryResult: any[];
  };
}

export const sessionInsightsApi = new Api<QueryParams, SessionInsightResponse>(
  "session-insights",
  async ({ sessions }, { client, sql }) => {
    // Parse the sessions string into an array of sessionId and sessionLabel pairs
    const sessionData = sessions.split(",").map((session) => {
      const [sessionId, sessionLabel] = session.trim().split("|");
      return { sessionId, sessionLabel };
    });

    // Map through each sessionData and run the query
    const queryResults = await Promise.all(
      sessionData.map(async ({ sessionId, sessionLabel }) => {
        const result = await client.query.execute(sql`SELECT
          sessionId,
          ${sessionLabel} AS sessionLabel,
          SUM(sqrt((arrayElement(acc, 1) * arrayElement(acc, 1)) +
                   (arrayElement(acc, 2) * arrayElement(acc, 2)) +
                   (arrayElement(acc, 3) * arrayElement(acc, 3)))) AS acc_movement_score,
          SUM(sqrt((arrayElement(gyro, 1) * arrayElement(gyro, 1)) +
                   (arrayElement(gyro, 2) * arrayElement(gyro, 2)) +
                   (arrayElement(gyro, 3) * arrayElement(gyro, 3)))) AS gyro_movement_score,
          (SUM(sqrt((arrayElement(acc, 1) * arrayElement(acc, 1)) +
                    (arrayElement(acc, 2) * arrayElement(acc, 2)) +
                    (arrayElement(acc, 3) * arrayElement(acc, 3)))) +
           SUM(sqrt((arrayElement(gyro, 1) * arrayElement(gyro, 1)) +
                    (arrayElement(gyro, 2) * arrayElement(gyro, 2)) +
                    (arrayElement(gyro, 3) * arrayElement(gyro, 3))))) AS total_movement_score
      FROM
          Brain
      WHERE
          sessionId = ${sessionId}
      GROUP BY
          sessionId`);
        return result;
      }),
    );

    const formattedData = await Promise.all(
      queryResults.map(async (queryResult) => {
        const result = await queryResult.json();
        return result.map((row: any) => row);
      }),
    );

    return {
      status: 200,
      success: true,
      data: {
        queryResult: formattedData,
      },
    };
  },
);
