import { GhEvent, RepoStarEvent, topicTimeseriesApi } from "moose-objects";
import { transformGhEvent } from "./ingest/transform";

// Streaming transformation to transform the raw GhEvent stream into an enriched RepoStarEvent stream
GhEvent.stream!.addTransform(RepoStarEvent.stream!, transformGhEvent);
