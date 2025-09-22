import { Api } from "@514labs/moose-lib";
import { Brain } from "../datamodels/brain";

interface QueryParams {
  sessionId: string;
}

export const getBrainBySessionIdApi = new Api<QueryParams, Brain[]>(
  "get-brain-by-session-id",
  async ({ sessionId }, { client, sql }) => {
    if (!sessionId) {
      throw new Error("Missing required parameter: sessionId");
    }

    const result = await client.query.execute(
      sql`SELECT * FROM Brain WHERE sessionId = ${sessionId}`,
    );
    return await result.json();
  },
);
