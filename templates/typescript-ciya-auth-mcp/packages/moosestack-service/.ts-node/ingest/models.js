"use strict";
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
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataEventPipeline = void 0;
var __typia_transform__validateReport = __importStar(
  require("typia/lib/internal/_validateReport.js"),
);
var __typia_transform__createStandardSchema = __importStar(
  require("typia/lib/internal/_createStandardSchema.js"),
);
var __typia_transform__assertGuard = __importStar(
  require("typia/lib/internal/_assertGuard.js"),
);
var typia_1 = __importDefault(require("typia"));
// Data model for MCP template demonstration
// DataEvent model with org_id for multi-tenant data isolation (Tier 3)
var moose_lib_1 = require("@514labs/moose-lib");
exports.DataEventPipeline = new moose_lib_1.IngestPipeline(
  "DataEvent",
  {
    table: true, // Create ClickHouse table
    stream: true, // Enable streaming
    ingestApi: true, // POST /ingest/DataEvent
  },
  {
    version: "3.1",
    components: {
      schemas: {
        StripInterfaceFieldsOptionalToUndefinedableDataEvent: {
          type: "object",
          properties: {
            eventId: {
              type: "string",
            },
            timestamp: {
              type: "string",
              format: "date-time",
            },
            eventType: {
              type: "string",
            },
            data: {
              type: "string",
            },
            org_id: {
              type: "string",
            },
          },
          required: ["eventId", "timestamp", "eventType", "data", "org_id"],
        },
      },
    },
    schemas: [
      {
        $ref: "#/components/schemas/StripInterfaceFieldsOptionalToUndefinedableDataEvent",
      },
    ],
  },
  JSON.parse(
    '[{"name":"eventId","data_type":"String","primary_key":true,"required":true,"unique":false,"default":null,"materialized":null,"ttl":null,"codec":null,"annotations":[],"comment":null},{"name":"timestamp","data_type":"DateTime","primary_key":false,"required":true,"unique":false,"default":null,"materialized":null,"ttl":null,"codec":null,"annotations":[],"comment":null},{"name":"eventType","data_type":"String","primary_key":false,"required":true,"unique":false,"default":null,"materialized":null,"ttl":null,"codec":null,"annotations":[],"comment":null},{"name":"data","data_type":"String","primary_key":false,"required":true,"unique":false,"default":null,"materialized":null,"ttl":null,"codec":null,"annotations":[],"comment":null},{"name":"org_id","data_type":"String","primary_key":false,"required":true,"unique":false,"default":null,"materialized":null,"ttl":null,"codec":null,"annotations":[],"comment":null}]',
  ),
  {
    validate: function (data) {
      var result = (function () {
        var _io0 = function (input) {
          return (
            "string" === typeof input.eventId &&
            input.timestamp instanceof Date &&
            "string" === typeof input.eventType &&
            "string" === typeof input.data &&
            "string" === typeof input.org_id
          );
        };
        var _vo0 = function (input, _path, _exceptionable) {
          if (_exceptionable === void 0) {
            _exceptionable = true;
          }
          return [
            "string" === typeof input.eventId ||
              _report(_exceptionable, {
                path: _path + ".eventId",
                expected: "string",
                value: input.eventId,
              }),
            input.timestamp instanceof Date ||
              _report(_exceptionable, {
                path: _path + ".timestamp",
                expected: "Date",
                value: input.timestamp,
              }),
            "string" === typeof input.eventType ||
              _report(_exceptionable, {
                path: _path + ".eventType",
                expected: "string",
                value: input.eventType,
              }),
            "string" === typeof input.data ||
              _report(_exceptionable, {
                path: _path + ".data",
                expected: "string",
                value: input.data,
              }),
            "string" === typeof input.org_id ||
              _report(_exceptionable, {
                path: _path + ".org_id",
                expected: "string",
                value: input.org_id,
              }),
          ].every(function (flag) {
            return flag;
          });
        };
        var __is = function (input) {
          return "object" === typeof input && null !== input && _io0(input);
        };
        var errors;
        var _report;
        return __typia_transform__createStandardSchema._createStandardSchema(
          function (input) {
            if (false === __is(input)) {
              errors = [];
              _report =
                __typia_transform__validateReport._validateReport(errors);
              (function (input, _path, _exceptionable) {
                if (_exceptionable === void 0) {
                  _exceptionable = true;
                }
                return (
                  ((("object" === typeof input && null !== input) ||
                    _report(true, {
                      path: _path + "",
                      expected:
                        "StripInterfaceFields<OptionalToUndefinedable<DataEvent>>",
                      value: input,
                    })) &&
                    _vo0(input, _path + "", true)) ||
                  _report(true, {
                    path: _path + "",
                    expected:
                      "StripInterfaceFields<OptionalToUndefinedable<DataEvent>>",
                    value: input,
                  })
                );
              })(input, "$input", true);
              var success = 0 === errors.length;
              return success ?
                  {
                    success: success,
                    data: input,
                  }
                : {
                    success: success,
                    errors: errors,
                    data: input,
                  };
            }
            return {
              success: true,
              data: input,
            };
          },
        );
      })()(data);
      return {
        success: result.success,
        data: result.success ? result.data : undefined,
        errors: result.success ? undefined : result.errors,
      };
    },
    assert: (function () {
      var _io0 = function (input) {
        return (
          "string" === typeof input.eventId &&
          input.timestamp instanceof Date &&
          "string" === typeof input.eventType &&
          "string" === typeof input.data &&
          "string" === typeof input.org_id
        );
      };
      var _ao0 = function (input, _path, _exceptionable) {
        if (_exceptionable === void 0) {
          _exceptionable = true;
        }
        return (
          ("string" === typeof input.eventId ||
            __typia_transform__assertGuard._assertGuard(
              _exceptionable,
              {
                method: "____moose____typia.createAssert",
                path: _path + ".eventId",
                expected: "string",
                value: input.eventId,
              },
              _errorFactory,
            )) &&
          (input.timestamp instanceof Date ||
            __typia_transform__assertGuard._assertGuard(
              _exceptionable,
              {
                method: "____moose____typia.createAssert",
                path: _path + ".timestamp",
                expected: "Date",
                value: input.timestamp,
              },
              _errorFactory,
            )) &&
          ("string" === typeof input.eventType ||
            __typia_transform__assertGuard._assertGuard(
              _exceptionable,
              {
                method: "____moose____typia.createAssert",
                path: _path + ".eventType",
                expected: "string",
                value: input.eventType,
              },
              _errorFactory,
            )) &&
          ("string" === typeof input.data ||
            __typia_transform__assertGuard._assertGuard(
              _exceptionable,
              {
                method: "____moose____typia.createAssert",
                path: _path + ".data",
                expected: "string",
                value: input.data,
              },
              _errorFactory,
            )) &&
          ("string" === typeof input.org_id ||
            __typia_transform__assertGuard._assertGuard(
              _exceptionable,
              {
                method: "____moose____typia.createAssert",
                path: _path + ".org_id",
                expected: "string",
                value: input.org_id,
              },
              _errorFactory,
            ))
        );
      };
      var __is = function (input) {
        return "object" === typeof input && null !== input && _io0(input);
      };
      var _errorFactory;
      return function (input, errorFactory) {
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
                    method: "____moose____typia.createAssert",
                    path: _path + "",
                    expected:
                      "StripInterfaceFields<OptionalToUndefinedable<DataEvent>>",
                    value: input,
                  },
                  _errorFactory,
                )) &&
                _ao0(input, _path + "", true)) ||
              __typia_transform__assertGuard._assertGuard(
                true,
                {
                  method: "____moose____typia.createAssert",
                  path: _path + "",
                  expected:
                    "StripInterfaceFields<OptionalToUndefinedable<DataEvent>>",
                  value: input,
                },
                _errorFactory,
              )
            );
          })(input, "$input", true);
        }
        return input;
      };
    })(),
    is: (function () {
      var _io0 = function (input) {
        return (
          "string" === typeof input.eventId &&
          input.timestamp instanceof Date &&
          "string" === typeof input.eventType &&
          "string" === typeof input.data &&
          "string" === typeof input.org_id
        );
      };
      return function (input) {
        return "object" === typeof input && null !== input && _io0(input);
      };
    })(),
  },
  false,
);
//# sourceMappingURL=models.js.map
