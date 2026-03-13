import { Octokit } from "@octokit/rest";
import {
  GetResponseDataTypeFromEndpointMethod,
  GetResponseTypeFromEndpointMethod,
  Endpoints,
} from "@octokit/types";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Initialize Octokit for type definitions
export const octokit = new Octokit();

// Export these types so they can be imported by other files
export type EventResponseType = GetResponseTypeFromEndpointMethod<
  typeof octokit.rest.activity.listPublicEvents
>;
export type EventType = GetResponseDataTypeFromEndpointMethod<
  typeof octokit.rest.activity.listPublicEvents
>;
export type EventRequestOptions = Endpoints["GET /events"]["parameters"] & {
  headers?: {
    "If-None-Match"?: string;
  };
};

export type RepoResponseType = GetResponseTypeFromEndpointMethod<
  typeof octokit.rest.repos.get
>;
export type RepoType = GetResponseDataTypeFromEndpointMethod<
  typeof octokit.rest.repos.get
>;
export type RepoRequestOptions =
  Endpoints["GET /repos/{owner}/{repo}"]["parameters"];

// Define the output interface that will be shared with other tasks
export interface FetchEventsOutput {
  events: EventType;
  fetchedAt: string;
  count: number;
  noNewEvents: boolean;
}

export const ETAG_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "github_etag.json",
);

// Ensure the data directory exists
export const ensureDataDir = () => {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
};

// Load etag from file if it exists
export const loadEtag = (): string | null => {
  try {
    if (fs.existsSync(ETAG_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(ETAG_FILE_PATH, "utf8"));
      return data.etag;
    }
  } catch (error) {
    console.warn("Failed to load etag:", error);
  }
  return null;
};

// Save etag to file
export const saveEtag = (etag: string): void => {
  try {
    ensureDataDir();
    fs.writeFileSync(
      ETAG_FILE_PATH,
      JSON.stringify({
        etag,
        updated: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.error("Failed to save etag:", error);
  }
};

// Create a new authenticated Octokit instance
export const createOctokit = () => {
  if (!process.env.GITHUB_TOKEN) {
    return new Octokit();
  }
  return new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });
};

export const getMooseUrl = () => {
  return process.env.MOOSE_URL || "http://localhost:4000";
};
