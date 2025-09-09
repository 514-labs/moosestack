import {
  IngestionFormat,
  IngestPipeline,
  Key,
  ClickHouseEngines,
} from "@514labs/moose-lib";

/**
 * Goodreads books data model containing information about books including title, author, ratings, and publication details
 */
interface BooksSchema {
  bookID: Key<number>;
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

export const BooksPipeline = new IngestPipeline<BooksSchema>("books", {
  table: {
    orderByFields: ["bookID"],
    engine: ClickHouseEngines.ReplacingMergeTree,
  },
  stream: true,
  ingestApi: {
    format: IngestionFormat.JSON,
  },
});
