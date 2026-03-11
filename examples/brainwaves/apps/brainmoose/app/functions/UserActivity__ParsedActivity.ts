// DMV2 Streaming Function: Converts local timestamps in UserActivity data to UTC.
// Using DMV2 IngestPipeline streams for type-safe stream processing

import {
  ParsedActivity,
  UserActivity,
  UserActivityPipeline,
  ParsedActivityPipeline,
} from "../datamodels/models";

// DMV2 Stream Transformation using pipeline streams
UserActivityPipeline.stream!.addTransform(
  ParsedActivityPipeline.stream!,
  (source: UserActivity): ParsedActivity => {
    // Convert local timestamp to UTC and return new ParsedActivity object.
    return {
      eventId: source.eventId, // Retain original event ID.
      userId: "puid" + source.userId, // Example: Prefix user ID.
      activity: source.activity, // Copy activity unchanged.
      timestamp: new Date(source.timestamp), // Convert timestamp to UTC.
    };
  },
  {
    metadata: { description: "Convert UserActivity timestamps to UTC" },
  },
);
