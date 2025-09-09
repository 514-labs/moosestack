import {
  IngestPipeline,
  Key,
  IngestionFormat,
  ClickHouseEngines,
} from "@514labs/moose-lib";

// Define the schema for Goodreads books
export interface GoodreadsBookSchema {
  bookID: Key<string>;
  title: string;
  authors: string;
  average_rating: number;
  isbn: string;
  isbn13: string;
  language_code: string;
  num_pages: number;
  ratings_count: number;
  text_reviews_count: number;
  publication_date: string;
  publisher: string;
}

// Create the pipeline for Goodreads books
export const GoodreadsBooksPipeline = new IngestPipeline<GoodreadsBookSchema>(
  "goodreads_books",
  {
    table: {
      orderByFields: ["bookID"],
      engine: ClickHouseEngines.ReplacingMergeTree,
    },
    stream: {
      parallelism: 4,
      retentionPeriod: 86400, // 24 hours
    },
    ingestApi: {
      format: IngestionFormat.JSON_ARRAY, // For batch ingestion
    },
  },
);
