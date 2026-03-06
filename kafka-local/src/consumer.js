"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
var kafka_javascript_1 = require("@confluentinc/kafka-javascript");
var confluent_schema_registry_1 = require("@kafkajs/confluent-schema-registry");
function main() {
  return __awaiter(this, void 0, void 0, function () {
    var brokers,
      topic,
      schemaRegistryUrl,
      decode,
      consumer,
      registry,
      OFFSET_BEGINNING;
    var _this = this;
    return __generator(this, function (_a) {
      switch (_a.label) {
        case 0:
          brokers = process.env.BOOTSTRAP || "localhost:19092";
          topic = process.env.TOPIC || "pg_cdc.public.customer_addresses";
          schemaRegistryUrl = "http://localhost:8081/apis/ccompat/v7/";
          decode = (process.env.DECODE || "true").toLowerCase() !== "false";
          consumer = new kafka_javascript_1.KafkaConsumer(
            {
              "metadata.broker.list": brokers,
              // group.id is required by KafkaConsumer, but we will NOT use group features.
              // We will manually assign partitions and never commit offsets.
              "group.id": "manual-reader",
              "enable.auto.commit": false,
            },
            {
              // We will explicitly start from beginning using manual assignment
              "auto.offset.reset": "earliest",
            },
          );
          registry = new confluent_schema_registry_1.SchemaRegistry({
            host: schemaRegistryUrl,
          });
          process.on("SIGINT", function () {
            return shutdown(consumer);
          });
          process.on("SIGTERM", function () {
            return shutdown(consumer);
          });
          OFFSET_BEGINNING = -2;
          return [
            4 /*yield*/,
            new Promise(function (resolve, reject) {
              consumer
                .on("ready", function () {
                  console.log(
                    "Connected to "
                      .concat(brokers, ". Assigning '")
                      .concat(topic, "' from beginning..."),
                  );
                  // Discover partitions, then manually assign from beginning for each
                  consumer.getMetadata(
                    { topic: topic, timeout: 10000 },
                    function (err, md) {
                      var _a, _b, _c, _d;
                      if (err) {
                        console.error("Metadata error", err);
                        reject(err);
                        return;
                      }
                      var topicMeta =
                        (
                          (_b =
                            (
                              (_a =
                                md === null || md === void 0 ?
                                  void 0
                                : md.topics) === null || _a === void 0
                            ) ?
                              void 0
                            : _a.find(function (t) {
                                return (
                                  (t === null || t === void 0 ?
                                    void 0
                                  : t.name) === topic
                                );
                              })) !== null && _b !== void 0
                        ) ?
                          _b
                        : (
                          (_c =
                            md === null || md === void 0 ?
                              void 0
                            : md.topics) === null || _c === void 0
                        ) ?
                          void 0
                        : _c[0];
                      var partitions = (
                        (
                          (_d =
                            topicMeta === null || topicMeta === void 0 ?
                              void 0
                            : topicMeta.partitions) !== null && _d !== void 0
                        ) ?
                          _d
                        : [])
                        .map(function (p) {
                          return p === null || p === void 0 ? void 0 : p.id;
                        })
                        .filter(function (p) {
                          return typeof p === "number";
                        });
                      if (!partitions.length) {
                        console.warn(
                          "No partitions found for topic '".concat(
                            topic,
                            "'. Assigning partition 0.",
                          ),
                        );
                      }
                      var assignments = (
                        partitions.length ? partitions : [0]).map(function (p) {
                        return {
                          topic: topic,
                          partition: p,
                          offset: OFFSET_BEGINNING,
                        };
                      });
                      consumer.assign(assignments);
                      consumer.consume();
                      resolve();
                    },
                  );
                })
                .on("event.error", function (err) {
                  console.error("Kafka error", err);
                })
                .on("disconnected", function (metrics) {
                  console.log("Disconnected", metrics);
                })
                .connect();
            }),
          ];
        case 1:
          _a.sent();
          consumer.on("data", function (message) {
            return __awaiter(_this, void 0, void 0, function () {
              var valueBuf, keyBuf, decodedValue, e_1, key, err_1;
              var _a, _b;
              return __generator(this, function (_c) {
                switch (_c.label) {
                  case 0:
                    _c.trys.push([0, 7, , 8]);
                    valueBuf =
                      (_a = message.value) !== null && _a !== void 0 ?
                        _a
                      : null;
                    keyBuf =
                      (_b = message.key) !== null && _b !== void 0 ? _b : null;
                    decodedValue = null;
                    if (!valueBuf) return [3 /*break*/, 6];
                    if (!decode) return [3 /*break*/, 5];
                    _c.label = 1;
                  case 1:
                    _c.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, registry.decode(valueBuf.subarray(4))];
                  case 2:
                    decodedValue = _c.sent();
                    return [3 /*break*/, 4];
                  case 3:
                    e_1 = _c.sent();
                    console.log(e_1);
                    console.log(valueBuf.toString("hex"));
                    return [3 /*break*/, 4];
                  case 4:
                    return [3 /*break*/, 6];
                  case 5:
                    decodedValue = valueBuf.toString("utf8");
                    _c.label = 6;
                  case 6:
                    key = keyBuf ? keyBuf.toString("utf8") : null;
                    console.log(
                      JSON.stringify(
                        {
                          topic: message.topic,
                          partition: message.partition,
                          offset: message.offset,
                          timestamp: message.timestamp,
                          key: key,
                          value: decodedValue,
                        },
                        null,
                        2,
                      ),
                    );
                    return [3 /*break*/, 8];
                  case 7:
                    err_1 = _c.sent();
                    console.error("Message handling error", err_1);
                    return [3 /*break*/, 8];
                  case 8:
                    return [2 /*return*/];
                }
              });
            });
          });
          return [2 /*return*/];
      }
    });
  });
}
function shutdown(consumer) {
  console.log("Shutting down consumer...");
  try {
    consumer.disconnect();
  } catch (e) {
    // ignore
  } finally {
    // A tiny delay to allow disconnect event
    setTimeout(function () {
      return process.exit(0);
    }, 100);
  }
}
main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
