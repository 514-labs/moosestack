import { expect } from "chai";
import { OlapTable, ClickHouseEngines } from "../src";

interface TestData {
  id: string;
  name: string;
  value: number;
}

describe("IcebergS3 Engine Configuration", () => {
  it("should create table with required fields only (Parquet)", () => {
    const table = new OlapTable<TestData>("test_iceberg", {
      engine: ClickHouseEngines.IcebergS3,
      path: "s3://bucket/warehouse/table/",
      format: "Parquet",
    });

    expect(table.name).to.equal("test_iceberg");
    expect((table.config as any).engine).to.equal(ClickHouseEngines.IcebergS3);
    expect((table.config as any).path).to.equal("s3://bucket/warehouse/table/");
    expect((table.config as any).format).to.equal("Parquet");
    expect((table.config as any).awsAccessKeyId).to.be.undefined;
    expect((table.config as any).awsSecretAccessKey).to.be.undefined;
  });

  it("should create table with all configuration options (ORC with credentials)", () => {
    const table = new OlapTable<TestData>("full_config", {
      engine: ClickHouseEngines.IcebergS3,
      path: "s3://datalake/warehouse/events/",
      format: "ORC",
      awsAccessKeyId: "AKIATEST123",
      awsSecretAccessKey: "secretkey456",
      compression: "zstd",
    });

    expect(table.name).to.equal("full_config");
    expect((table.config as any).path).to.equal(
      "s3://datalake/warehouse/events/",
    );
    expect((table.config as any).format).to.equal("ORC");
    expect((table.config as any).awsAccessKeyId).to.equal("AKIATEST123");
    expect((table.config as any).awsSecretAccessKey).to.equal("secretkey456");
    expect((table.config as any).compression).to.equal("zstd");
  });

  it("should work with noSign flag for public buckets (no credentials)", () => {
    const table = new OlapTable<TestData>("public_data", {
      engine: ClickHouseEngines.IcebergS3,
      path: "s3://public-bucket/data/",
      format: "Parquet",
      noSign: true,
    } as const);

    expect((table.config as any).noSign).to.equal(true);
    expect((table.config as any).awsAccessKeyId).to.be.undefined;
    expect((table.config as any).awsSecretAccessKey).to.be.undefined;
  });
});
