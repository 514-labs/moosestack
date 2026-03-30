import {
  OlapTable,
  ClickHouseInt,
  ClickHouseDecimal,
  ClickHousePrecision,
  ClickHouseByteSize,
  ClickHouseNamedTuple,
  ClickHouseEngines,
  ClickHouseDefault,
  WithDefault,
  LifeCycle,
  ClickHouseTTL,
  ClickHouseCodec,
  ClickHouseMaterialized,
  SimpleAggregated,
  LowCardinality,
  ClickHouseAlias,
  TableConstraint,
} from "@514labs/moose-lib";
export interface amt_RtiAdGroupSpendHealth {
  ReportHourUtc: Date & ClickHouseCodec<"Delta(4), ZSTD(1)">;
  AdvertiserId: string & LowCardinality & ClickHouseCodec<"ZSTD(1)">;
  AdGroupId: string & ClickHouseCodec<"ZSTD(1)">;
  BatchId: string[] &
    SimpleAggregated<"groupUniqArrayArray", string[]> &
    ClickHouseCodec<"ZSTD(1)">;
  CampaignId: string & ClickHouseCodec<"ZSTD(1)">;
  CampaignFlightId: number &
    ClickHouseInt<"int64"> &
    ClickHouseCodec<"T64, ZSTD(1)">;
  DecisionPower:
    | (number & ClickHouseInt<"int64"> & ClickHouseCodec<"T64, ZSTD(1)">)
    | undefined;
  DecisionPowerHealth:
    | (number & ClickHouseInt<"int64"> & ClickHouseCodec<"T64, ZSTD(1)">)
    | undefined;
  PartnerId: string & LowCardinality & ClickHouseCodec<"ZSTD(1)">;
  TenantId: number & ClickHouseInt<"int64"> & ClickHouseCodec<"T64, ZSTD(1)">;
  AdvertiserCostInUSD: string &
    ClickHouseDecimal<18, 8> &
    SimpleAggregated<"sumWithOverflow", string & ClickHouseDecimal<18, 8>> &
    ClickHouseCodec<"ZSTD(1)"> &
    ClickHouseDefault<"0">;
  AdvertiserCostInAdvertiserCurrency: string &
    ClickHouseDecimal<18, 8> &
    SimpleAggregated<"sumWithOverflow", string & ClickHouseDecimal<18, 8>> &
    ClickHouseCodec<"ZSTD(1)"> &
    ClickHouseDefault<"0">;
  AdvertiserCostInPartnerCurrency: string &
    ClickHouseDecimal<18, 8> &
    SimpleAggregated<"sumWithOverflow", string & ClickHouseDecimal<18, 8>> &
    ClickHouseCodec<"ZSTD(1)"> &
    ClickHouseDefault<"0">;
}
export type amt_RtiAdGroupSpendHealth_local = amt_RtiAdGroupSpendHealth;
export const AmtRtiAdGroupSpendHealthTable =
  new OlapTable<amt_RtiAdGroupSpendHealth>("amt_RtiAdGroupSpendHealth", {
    database: "reports",
    engine: ClickHouseEngines.Distributed,
    cluster: "{cluster}",
    targetDatabase: "reports",
    targetTable: "amt_RtiAdGroupSpendHealth_local",
    shardingKey: "cityHash64(AdvertiserId)",
    lifeCycle: LifeCycle.DELETION_PROTECTED,
  });
export const AmtRtiAdGroupSpendHealthLocalTable =
  new OlapTable<amt_RtiAdGroupSpendHealth_local>(
    "amt_RtiAdGroupSpendHealth_local",
    {
      cluster: "{cluster}",
      database: "reports",
      orderByFields: [
        "PartnerId",
        "AdvertiserId",
        "CampaignId",
        "AdGroupId",
        "CampaignFlightId",
        "DecisionPowerHealth",
        "DecisionPower",
        "TenantId",
        "ReportHourUtc",
      ],
      primaryKeyExpression:
        "(PartnerId, AdvertiserId, CampaignId, AdGroupId, CampaignFlightId, DecisionPowerHealth, DecisionPower)",
      partitionBy: "toDate(ReportHourUtc)",
      engine: ClickHouseEngines.ReplicatedAggregatingMergeTree,
      keeperPath:
        "/clickhouse/{cluster}/tables/reports/amt_RtiAdGroupSpendHealth_local/{shard}",
      replicaName: "{replica}",
      settings: {
        index_granularity: "8192",
        ttl_only_drop_parts: "1",
        allow_nullable_key: "1",
      },
      ttl: "ReportHourUtc + toIntervalDay(102)",
      lifeCycle: LifeCycle.DELETION_PROTECTED,
    },
  );
