import { GhEvent, RepoStarEvent, topicTimeseriesApi } from "moose-objects";
import { transformGhEvent } from "./ingest/transform";
import { getGithubEventsWorkflow } from "./scripts/getGithubEvents/1.fetchEvents";

// Streaming transformation to transform the raw GhEvent stream into an enriched RepoStarEvent stream
GhEvent.stream!.addTransform(RepoStarEvent.stream!, transformGhEvent);

// Export workflow for registration
export { getGithubEventsWorkflow };
