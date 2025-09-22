import { Api } from "@514labs/moose-lib";

interface QueryParams {
  sessionId: string;
  limit?: string;
}

interface BrainwaveData {
  sessionId: string;
  avg_alpha: number;
  avg_beta: number;
  avg_delta: number;
  avg_theta: number;
  avg_gamma: number;
  total_alpha: number;
  total_beta: number;
  total_delta: number;
  total_theta: number;
  total_gamma: number;
  record_count: number;
}

export const getMostActiveBrainwavesApi = new Api<QueryParams, any>(
  "get-most-active-brainwaves",
  async ({ sessionId, limit }, { client, sql }) => {
    if (!sessionId) {
      throw new Error("Missing required parameter: sessionId");
    }

    const limitValue = limit || "5";
    const limitNum = parseInt(limitValue);
    if (isNaN(limitNum) || limitNum <= 0) {
      throw new Error("Invalid limit parameter: must be a positive number");
    }

    const result = await client.query.execute(
      sql`
        SELECT 
          sessionId,
          AVG(alpha) as avg_alpha,
          AVG(beta) as avg_beta, 
          AVG(delta) as avg_delta,
          AVG(theta) as avg_theta,
          AVG(gamma) as avg_gamma,
          SUM(alpha) as total_alpha,
          SUM(beta) as total_beta,
          SUM(delta) as total_delta, 
          SUM(theta) as total_theta,
          SUM(gamma) as total_gamma,
          COUNT(*) as record_count
        FROM Brain 
        WHERE sessionId = ${sessionId}
        GROUP BY sessionId
      `,
    );

    const data = (await result.json()) as BrainwaveData[];

    if (data.length === 0) {
      return [];
    }

    const brainwaveData = data[0];

    // Create array of brainwave activities and sort by average activity
    const brainwaveActivities = [
      {
        brainwaveType: "alpha",
        averageActivity: brainwaveData.avg_alpha,
        totalActivity: brainwaveData.total_alpha,
        recordCount: brainwaveData.record_count,
      },
      {
        brainwaveType: "beta",
        averageActivity: brainwaveData.avg_beta,
        totalActivity: brainwaveData.total_beta,
        recordCount: brainwaveData.record_count,
      },
      {
        brainwaveType: "delta",
        averageActivity: brainwaveData.avg_delta,
        totalActivity: brainwaveData.total_delta,
        recordCount: brainwaveData.record_count,
      },
      {
        brainwaveType: "theta",
        averageActivity: brainwaveData.avg_theta,
        totalActivity: brainwaveData.total_theta,
        recordCount: brainwaveData.record_count,
      },
      {
        brainwaveType: "gamma",
        averageActivity: brainwaveData.avg_gamma,
        totalActivity: brainwaveData.total_gamma,
        recordCount: brainwaveData.record_count,
      },
    ];

    // Sort by average activity (descending) and return top N
    return brainwaveActivities
      .sort((a, b) => b.averageActivity - a.averageActivity)
      .slice(0, limitNum);
  },
);
