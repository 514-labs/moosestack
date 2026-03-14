/**
 * Review Metrics — semantic query model for Amazon review analytics.
 *
 * This is the single source of truth for review metrics. Every consumer —
 * dashboard REST APIs, MCP tools, and AI SDK — uses this definition,
 * guaranteeing consistent calculations across all interfaces.
 *
 * All column references use `AmazonReviewTable.columns.*` so that
 * renaming a field in the AmazonReview interface produces a compile
 * error here instead of silently generating wrong SQL at runtime.
 *
 * ## Consumption
 *
 * - **MCP tool**: Automatically registered as `query_review_metrics`
 *   via `registerModelTools()` in `mcp.ts`.
 * - **REST API**: Use `buildQuery(reviewMetrics)` in Express endpoints.
 * - **AI SDK**: Can be projected via `createModelTool()` for Vercel AI SDK.
 *
 * @see https://docs.fiveonefour.com/moosestack/apis/semantic-layer
 */
import {
  defineQueryModel,
  sql,
  count,
  avg,
  min,
  max,
  countDistinct,
} from "@514labs/moose-lib";
import { AmazonReviewTable } from "../ingest/models";

export const reviewMetrics = defineQueryModel({
  name: "query_review_metrics",
  description:
    "Amazon product review metrics from the Customer Reviews Dataset (~25M reviews). " +
    "Dimensions: marketplace, product_category, star_rating, vine, verified_purchase, " +
    "and time granularities (day, month). " +
    "Metrics: review counts, average rating, helpful vote stats, product/customer counts. " +
    "Filters: marketplace, product_category, star_rating, vine, verified_purchase, " +
    "review_date range, product_id, and text search on review_headline.",

  table: AmazonReviewTable,

  // --- Dimensions -----------------------------------------------------------

  dimensions: {
    marketplace: {
      column: "marketplace",
      description: "Amazon marketplace code (US, UK, DE, FR, JP)",
    },
    product_category: {
      column: "product_category",
      description:
        "Product category (Books, Electronics, Music, etc. — ~43 unique values)",
    },
    star_rating: {
      column: "star_rating",
      description: "Star rating (1–5)",
    },
    vine: {
      column: "vine",
      description: "Whether the reviewer is in the Amazon Vine program",
    },
    verified_purchase: {
      column: "verified_purchase",
      description: "Whether the review is from a verified purchase",
    },
    day: {
      expression: sql`FROM_UNIXTIME(${AmazonReviewTable.columns.review_date} * 86400, '%Y-%m-%d')`,
      as: "day",
      description: "Calendar day (derived from review_date epoch days)",
    },
    month: {
      expression: sql`FROM_UNIXTIME(${AmazonReviewTable.columns.review_date} * 86400, '%Y-%m')`,
      as: "month",
      description: "Year-month bucket",
    },
  },

  // --- Metrics ---------------------------------------------------------------

  metrics: {
    totalReviews: {
      agg: count(),
      as: "totalReviews",
      description: "Total number of reviews",
    },
    avgRating: {
      agg: avg(AmazonReviewTable.columns.star_rating),
      as: "avgRating",
      description: "Average star rating (1–5)",
    },
    totalHelpfulVotes: {
      agg: sql`sum(${AmazonReviewTable.columns.helpful_votes})`,
      as: "totalHelpfulVotes",
      description: "Sum of helpful votes across all reviews",
    },
    totalVotes: {
      agg: sql`sum(${AmazonReviewTable.columns.total_votes})`,
      as: "totalVotes",
      description: "Sum of all votes (helpful + unhelpful)",
    },
    avgHelpfulVotes: {
      agg: avg(AmazonReviewTable.columns.helpful_votes),
      as: "avgHelpfulVotes",
      description: "Average helpful votes per review",
    },
    uniqueProducts: {
      agg: countDistinct(AmazonReviewTable.columns.product_id),
      as: "uniqueProducts",
      description: "Count of distinct products reviewed",
    },
    uniqueCustomers: {
      agg: countDistinct(AmazonReviewTable.columns.customer_id),
      as: "uniqueCustomers",
      description: "Count of distinct customers who left reviews",
    },
    fiveStarReviews: {
      agg: sql`countIf(${AmazonReviewTable.columns.star_rating} = 5)`,
      as: "fiveStarReviews",
      description: "Count of 5-star reviews",
    },
    oneStarReviews: {
      agg: sql`countIf(${AmazonReviewTable.columns.star_rating} = 1)`,
      as: "oneStarReviews",
      description: "Count of 1-star reviews",
    },
    verifiedPurchaseCount: {
      agg: sql`countIf(${AmazonReviewTable.columns.verified_purchase} = true)`,
      as: "verifiedPurchaseCount",
      description: "Count of verified purchase reviews",
    },
    vineReviewCount: {
      agg: sql`countIf(${AmazonReviewTable.columns.vine} = true)`,
      as: "vineReviewCount",
      description: "Count of Amazon Vine program reviews",
    },
    helpfulnessRate: {
      agg: sql`if(sum(${AmazonReviewTable.columns.total_votes}) > 0, round(sum(${AmazonReviewTable.columns.helpful_votes}) / sum(${AmazonReviewTable.columns.total_votes}), 4), 0)`,
      as: "helpfulnessRate",
      description: "Ratio of helpful votes to total votes (0–1)",
    },
  },

  // --- Filters ---------------------------------------------------------------

  filters: {
    marketplace: {
      column: "marketplace",
      operators: ["eq", "in"] as const,
      description: "Filter by marketplace (US, UK, DE, FR, JP)",
    },
    product_category: {
      column: "product_category",
      operators: ["eq", "in"] as const,
      description: "Filter by product category",
    },
    star_rating: {
      column: "star_rating",
      operators: ["eq", "gte", "lte"] as const,
      description: "Filter by star rating (1–5)",
    },
    vine: {
      column: "vine",
      operators: ["eq"] as const,
      description: "Filter by Vine program membership (true/false)",
    },
    verified_purchase: {
      column: "verified_purchase",
      operators: ["eq"] as const,
      description: "Filter by verified purchase status (true/false)",
    },
    review_date: {
      column: "review_date",
      operators: ["gte", "lte"] as const,
      description: "Filter by review_date (UInt16 days since epoch)",
    },
    product_id: {
      column: "product_id",
      operators: ["eq", "in"] as const,
      description: "Filter by Amazon product ASIN",
    },
    review_headline: {
      column: "review_headline",
      operators: ["ilike"] as const,
      description: "Search review headlines (case-insensitive pattern match)",
    },
  },

  // --- Sortable & Defaults ---------------------------------------------------

  sortable: [
    "totalReviews",
    "avgRating",
    "totalHelpfulVotes",
    "uniqueProducts",
    "uniqueCustomers",
    "fiveStarReviews",
    "oneStarReviews",
    "helpfulnessRate",
    "day",
    "month",
  ] as const,

  defaults: {
    metrics: ["totalReviews", "avgRating", "uniqueProducts"],
    dimensions: [],
    orderBy: [],
    limit: 100,
    maxLimit: 1000,
  },
});
