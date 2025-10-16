"use strict";
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoodreadsBooksPipeline = void 0;
var typia_1 = __importDefault(require("typia"));
var moose_lib_1 = require("@514labs/moose-lib");
// Create the pipeline for Goodreads books
exports.GoodreadsBooksPipeline = new moose_lib_1.IngestPipeline(
  "goodreads_books",
  {
    table: {
      orderByFields: ["bookID"],
      deduplicate: true,
    },
    stream: {
      parallelism: 4,
      retentionPeriod: 86400, // 24 hours
    },
    ingest: {
      format: moose_lib_1.IngestionFormat.JSON_ARRAY, // For batch ingestion
    },
  },
  {
    version: "3.1",
    components: {
      schemas: {
        GoodreadsBookSchema: {
          type: "object",
          properties: {
            bookID: {
              type: "string",
            },
            title: {
              type: "string",
            },
            authors: {
              type: "string",
            },
            average_rating: {
              type: "number",
            },
            isbn: {
              type: "string",
            },
            isbn13: {
              type: "string",
            },
            language_code: {
              type: "string",
            },
            num_pages: {
              type: "number",
            },
            ratings_count: {
              type: "number",
            },
            text_reviews_count: {
              type: "number",
            },
            publication_date: {
              type: "string",
            },
            publisher: {
              type: "string",
            },
          },
          required: [
            "bookID",
            "title",
            "authors",
            "average_rating",
            "isbn",
            "isbn13",
            "language_code",
            "num_pages",
            "ratings_count",
            "text_reviews_count",
            "publication_date",
            "publisher",
          ],
        },
      },
    },
    schemas: [
      {
        $ref: "#/components/schemas/GoodreadsBookSchema",
      },
    ],
  },
  JSON.parse(
    '[{"name":"bookID","data_type":"String","primary_key":true,"required":true,"unique":false,"default":null},{"name":"title","data_type":"String","primary_key":false,"required":true,"unique":false,"default":null},{"name":"authors","data_type":"String","primary_key":false,"required":true,"unique":false,"default":null},{"name":"average_rating","data_type":"Float","primary_key":false,"required":true,"unique":false,"default":null},{"name":"isbn","data_type":"String","primary_key":false,"required":true,"unique":false,"default":null},{"name":"isbn13","data_type":"String","primary_key":false,"required":true,"unique":false,"default":null},{"name":"language_code","data_type":"String","primary_key":false,"required":true,"unique":false,"default":null},{"name":"num_pages","data_type":"Float","primary_key":false,"required":true,"unique":false,"default":null},{"name":"ratings_count","data_type":"Float","primary_key":false,"required":true,"unique":false,"default":null},{"name":"text_reviews_count","data_type":"Float","primary_key":false,"required":true,"unique":false,"default":null},{"name":"publication_date","data_type":"String","primary_key":false,"required":true,"unique":false,"default":null},{"name":"publisher","data_type":"String","primary_key":false,"required":true,"unique":false,"default":null}]',
  ),
);
//# sourceMappingURL=goodreads_books.js.map
