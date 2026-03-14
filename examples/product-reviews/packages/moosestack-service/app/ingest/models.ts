import {
  OlapTable,
  Stream,
  IngestApi,
  LowCardinality,
  UInt8,
  UInt16,
  UInt32,
} from "@514labs/moose-lib";

/**
 * Amazon Customer Review record from the Amazon Customer Reviews Dataset.
 *
 * Each row represents a single product review submitted on Amazon,
 * including metadata about the reviewer, the product, and the review content.
 *
 * @see https://datasets-documentation.s3.eu-west-3.amazonaws.com/amazon_reviews/
 */
export interface AmazonReview {
  /** Unique review identifier (e.g. "R2U1Z31MRBJLQ2") */
  review_id: string;

  /** Days since Unix epoch when the review was posted */
  review_date: UInt16;

  /** Amazon marketplace code (e.g. "US", "UK", "DE", "FR", "JP") — ~5 unique values */
  marketplace: string & LowCardinality;

  /** Numeric customer identifier */
  customer_id: UInt32;

  /** Amazon Standard Identification Number (ASIN) of the reviewed product */
  product_id: string;

  /** Parent ASIN grouping product variants together */
  product_parent: UInt32;

  /** Display title of the reviewed product */
  product_title: string;

  /** Top-level product category (e.g. "Books", "Music", "Electronics") — ~40 unique values */
  product_category: string & LowCardinality;

  /** Star rating from 1 (worst) to 5 (best) */
  star_rating: UInt8;

  /** Number of helpful votes the review received */
  helpful_votes: UInt32;

  /** Total number of votes (helpful + unhelpful) the review received */
  total_votes: UInt32;

  /** Whether the reviewer is part of the Amazon Vine program */
  vine: boolean;

  /** Whether the reviewer purchased the product on Amazon */
  verified_purchase: boolean;

  /** Short summary headline of the review */
  review_headline: string;

  /** Full text body of the review */
  review_body: string;
}

/**
 * ClickHouse OLAP table for Amazon reviews.
 *
 * ORDER BY follows low-to-high cardinality per `schema-pk-cardinality-order`:
 *   1. marketplace       (~5 unique values  — enables broad partition pruning)
 *   2. product_category  (~40 unique values — common filter/group-by column)
 *   3. review_date       (~365 values/year  — time-range scans)
 *   4. review_id         (unique per row    — tiebreaker for deterministic ordering)
 *
 * Filter columns (marketplace, product_category, review_date) are placed first
 * per `schema-pk-prioritize-filters` so WHERE clauses hit the sparse index.
 */
export const AmazonReviewTable = new OlapTable<AmazonReview>("AmazonReview", {
  orderByFields: [
    "marketplace",
    "product_category",
    "review_date",
    "review_id",
  ],
});

/** Streaming topic wired to the AmazonReview table */
export const AmazonReviewStream = new Stream<AmazonReview>("AmazonReview", {
  destination: AmazonReviewTable,
});

/** REST ingestion endpoint — POST /ingest/AmazonReview */
export const AmazonReviewApi = new IngestApi<AmazonReview>("AmazonReview", {
  destination: AmazonReviewStream,
});
