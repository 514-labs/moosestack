"use strict";
var __makeTemplateObject =
  (this && this.__makeTemplateObject) ||
  function (cooked, raw) {
    if (Object.defineProperty) {
      Object.defineProperty(cooked, "raw", { value: raw });
    } else {
      cooked.raw = raw;
    }
    return cooked;
  };
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create ?
    function (o, m, k, k2) {
      if (k2 === undefined) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (
        !desc ||
        ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
      ) {
        desc = {
          enumerable: true,
          get: function () {
            return m[k];
          },
        };
      }
      Object.defineProperty(o, k2, desc);
    }
  : function (o, m, k, k2) {
      if (k2 === undefined) k2 = k;
      o[k2] = m[k];
    });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create ?
    function (o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }
  : function (o, v) {
      o["default"] = v;
    });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== "default") __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P ? value : (
          new P(function (resolve) {
            resolve(value);
          })
        );
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ?
          resolve(result.value)
        : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
var __generator =
  (this && this.__generator) ||
  function (thisArg, body) {
    var _ = {
        label: 0,
        sent: function () {
          if (t[0] & 1) throw t[1];
          return t[1];
        },
        trys: [],
        ops: [],
      },
      f,
      y,
      t,
      g = Object.create(
        (typeof Iterator === "function" ? Iterator : Object).prototype,
      );
    return (
      (g.next = verb(0)),
      (g["throw"] = verb(1)),
      (g["return"] = verb(2)),
      typeof Symbol === "function" &&
        (g[Symbol.iterator] = function () {
          return this;
        }),
      g
    );
    function verb(n) {
      return function (v) {
        return step([n, v]);
      };
    }
    function step(op) {
      if (f) throw new TypeError("Generator is already executing.");
      while ((g && ((g = 0), op[0] && (_ = 0)), _))
        try {
          if (
            ((f = 1),
            y &&
              (t =
                op[0] & 2 ? y["return"]
                : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0)
                : y.next) &&
              !(t = t.call(y, op[1])).done)
          )
            return t;
          if (((y = 0), t)) op = [op[0] & 2, t.value];
          switch (op[0]) {
            case 0:
            case 1:
              t = op;
              break;
            case 4:
              _.label++;
              return { value: op[1], done: false };
            case 5:
              _.label++;
              y = op[1];
              op = [0];
              continue;
            case 7:
              op = _.ops.pop();
              _.trys.pop();
              continue;
            default:
              if (
                !((t = _.trys), (t = t.length > 0 && t[t.length - 1])) &&
                (op[0] === 6 || op[0] === 2)
              ) {
                _ = 0;
                continue;
              }
              if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) {
                _.label = op[1];
                break;
              }
              if (op[0] === 6 && _.label < t[1]) {
                _.label = t[1];
                t = op;
                break;
              }
              if (t && _.label < t[2]) {
                _.label = t[2];
                _.ops.push(op);
                break;
              }
              if (t[2]) _.ops.pop();
              _.trys.pop();
              continue;
          }
          op = body.call(thisArg, _);
        } catch (e) {
          op = [6, e];
          y = 0;
        } finally {
          f = t = 0;
        }
      if (op[0] & 5) throw op[1];
      return { value: op[0] ? op[1] : void 0, done: true };
    }
  };
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBooksByYearSortedByRating = void 0;
var __typia_transform__isTypeInt32 = __importStar(
  require("typia/lib/internal/_isTypeInt32.js"),
);
var __typia_transform__assertGuard = __importStar(
  require("typia/lib/internal/_assertGuard.js"),
);
var __typia_transform__httpQueryParseURLSearchParams = __importStar(
  require("typia/lib/internal/_httpQueryParseURLSearchParams.js"),
);
var __typia_transform__httpQueryReadNumber = __importStar(
  require("typia/lib/internal/_httpQueryReadNumber.js"),
);
var typia_1 = __importDefault(require("typia"));
var moose_lib_1 = require("@514labs/moose-lib");
/**
 * API that returns a list of books for a given year, sorted by their average rating in descending order.
 * Only includes books with a significant number of ratings (>1000) to ensure reliability.
 */
exports.getBooksByYearSortedByRating = new moose_lib_1.ConsumptionApi(
  "getBooksByYearSortedByRating",
  function (params, utils) {
    var assertGuard = (function () {
      var _io0 = function (input) {
        return (
          "number" === typeof input.year &&
          __typia_transform__isTypeInt32._isTypeInt32(input.year) &&
          1800 <= input.year &&
          input.year <= 2100
        );
      };
      var _ao0 = function (input, _path, _exceptionable) {
        if (_exceptionable === void 0) {
          _exceptionable = true;
        }
        return (
          ("number" === typeof input.year &&
            (__typia_transform__isTypeInt32._isTypeInt32(input.year) ||
              __typia_transform__assertGuard._assertGuard(
                _exceptionable,
                {
                  method: "____moose____typia.http.createAssertQuery",
                  path: _path + ".year",
                  expected: 'number & Type<"int32">',
                  value: input.year,
                },
                _errorFactory,
              )) &&
            (1800 <= input.year ||
              __typia_transform__assertGuard._assertGuard(
                _exceptionable,
                {
                  method: "____moose____typia.http.createAssertQuery",
                  path: _path + ".year",
                  expected: "number & Minimum<1800>",
                  value: input.year,
                },
                _errorFactory,
              )) &&
            (input.year <= 2100 ||
              __typia_transform__assertGuard._assertGuard(
                _exceptionable,
                {
                  method: "____moose____typia.http.createAssertQuery",
                  path: _path + ".year",
                  expected: "number & Maximum<2100>",
                  value: input.year,
                },
                _errorFactory,
              ))) ||
          __typia_transform__assertGuard._assertGuard(
            _exceptionable,
            {
              method: "____moose____typia.http.createAssertQuery",
              path: _path + ".year",
              expected:
                '(number & Type<"int32"> & Minimum<1800> & Maximum<2100>)',
              value: input.year,
            },
            _errorFactory,
          )
        );
      };
      var __is = function (input) {
        return "object" === typeof input && null !== input && _io0(input);
      };
      var _errorFactory;
      var __assert = function (input, errorFactory) {
        if (false === __is(input)) {
          _errorFactory = errorFactory;
          (function (input, _path, _exceptionable) {
            if (_exceptionable === void 0) {
              _exceptionable = true;
            }
            return (
              ((("object" === typeof input && null !== input) ||
                __typia_transform__assertGuard._assertGuard(
                  true,
                  {
                    method: "____moose____typia.http.createAssertQuery",
                    path: _path + "",
                    expected: "BooksByYearParams",
                    value: input,
                  },
                  _errorFactory,
                )) &&
                _ao0(input, _path + "", true)) ||
              __typia_transform__assertGuard._assertGuard(
                true,
                {
                  method: "____moose____typia.http.createAssertQuery",
                  path: _path + "",
                  expected: "BooksByYearParams",
                  value: input,
                },
                _errorFactory,
              )
            );
          })(input, "$input", true);
        }
        return input;
      };
      var __decode = function (input) {
        input =
          __typia_transform__httpQueryParseURLSearchParams._httpQueryParseURLSearchParams(
            input,
          );
        var output = {
          year: __typia_transform__httpQueryReadNumber._httpQueryReadNumber(
            input.get("year"),
          ),
        };
        return output;
      };
      return function (input, errorFactory) {
        return __assert(__decode(input), errorFactory);
      };
    })();
    var searchParams = new URLSearchParams(params);
    var processedParams = assertGuard(searchParams);
    return (function (params, utils) {
      return __awaiter(void 0, void 0, void 0, function () {
        var client, sql, result, books, error_1;
        return __generator(this, function (_a) {
          switch (_a.label) {
            case 0:
              ((client = utils.client), (sql = utils.sql));
              _a.label = 1;
            case 1:
              _a.trys.push([1, 4, , 5]);
              return [
                4 /*yield*/,
                client.query.execute(
                  sql(
                    templateObject_1 ||
                      (templateObject_1 = __makeTemplateObject(
                        [
                          "\n        WITH filtered_books AS (\n          SELECT \n            title,\n            authors,\n            ROUND(CAST(average_rating AS Float64), 2) as rating,\n            CAST(ratings_count AS Int64) as ratings_count,\n            CAST(text_reviews_count AS Int64) as reviews_count,\n            publication_date,\n            publisher,\n            CAST(num_pages AS Int32) as pages\n          FROM books\n          WHERE toYear(parseDateTime64BestEffort(publication_date)) = ",
                          "\n            AND ratings_count >= 1000\n        )\n        SELECT *\n        FROM filtered_books\n        ORDER BY rating DESC, ratings_count DESC\n      ",
                        ],
                        [
                          "\n        WITH filtered_books AS (\n          SELECT \n            title,\n            authors,\n            ROUND(CAST(average_rating AS Float64), 2) as rating,\n            CAST(ratings_count AS Int64) as ratings_count,\n            CAST(text_reviews_count AS Int64) as reviews_count,\n            publication_date,\n            publisher,\n            CAST(num_pages AS Int32) as pages\n          FROM books\n          WHERE toYear(parseDateTime64BestEffort(publication_date)) = ",
                          "\n            AND ratings_count >= 1000\n        )\n        SELECT *\n        FROM filtered_books\n        ORDER BY rating DESC, ratings_count DESC\n      ",
                        ],
                      )),
                    params.year,
                  ),
                ),
              ];
            case 2:
              result = _a.sent();
              return [4 /*yield*/, result.json()];
            case 3:
              books = _a.sent();
              return [
                2 /*return*/,
                {
                  success: true,
                  count: books.length,
                  books: books,
                },
              ];
            case 4:
              error_1 = _a.sent();
              // Basic error handling
              console.error("Error fetching books by year:", error_1);
              return [
                2 /*return*/,
                {
                  success: false,
                  error: "Failed to fetch books",
                  details:
                    error_1 instanceof Error ?
                      error_1.message
                    : "Unknown error",
                },
              ];
            case 5:
              return [2 /*return*/];
          }
        });
      });
    })(processedParams, utils);
  },
  {},
  {
    version: "3.1",
    components: {
      schemas: {
        BooksByYearParams: {
          type: "object",
          properties: {
            year: {
              type: "integer",
              minimum: 1800,
              maximum: 2100,
              description: "The publication year to filter by (e.g., 2006)",
            },
          },
          required: ["year"],
          description: "Parameters for the getBooksByYearSortedByRating API",
        },
      },
    },
    schemas: [
      {
        $ref: "#/components/schemas/BooksByYearParams",
      },
    ],
  },
  JSON.parse("[]"),
);
var templateObject_1;
//# sourceMappingURL=getBooksByYearSortedByRating.js.map
