/**
 * Example BYOF (Bring Your Own Framework) Express app
 *
 * This file demonstrates how to use Express with MooseStack for consumption
 * APIs.
 */

import express, { Request, Response, NextFunction } from "express";
import {
  sql,
  getMooseClients,
  mooseLogger,
  type MooseClient,
} from "@514labs/moose-lib";
import { BarPipeline } from "../ingest/models";

interface QueryParams {
  maxResults: number;
}

// Extend Express Request to include our client
interface RequestWithClient extends Request<{}, {}, {}, QueryParams> {
  client?: MooseClient;
}

interface ResultItem {
  primaryKey: string;
  textLength: number;
}

/**
 * This function is called by Moose to create your Express app.
 * It should return a configured Express application.
 */
export async function createApp() {
  const app = express();
  const { client } = await getMooseClients();

  // Add Moose logging middleware to log requests in the same format as Api class
  app.use(mooseLogger);

  // Middleware to attach Moose client to requests
  app.use((req: RequestWithClient, _res: Response, next: NextFunction) => {
    req.client = client;
    next();
  });

  // Example: Custom endpoint that queries ClickHouse
  app.get("/moose", async (req: RequestWithClient, res: Response) => {
    const { client } = req;
    const SourceTable = BarPipeline.table!;
    const cols = SourceTable.columns;

    const query = sql` SELECT ${cols.primaryKey}, ${cols.textLength} FROM ${SourceTable} LIMIT ${req.query.maxResults || 10}`;

    // Set the result type to the type of the each row in the result set
    const resultSet = await client?.query.execute<ResultItem>(query);

    // Return the result set as an array of the result item type
    const data = await resultSet?.json();
    res.send(data);
  });

  return app;
}
