import { expect } from "chai";
import { getMooseClients } from "../src/consumption-apis/standalone";
import { sql } from "../src/sqlHelpers";

describe("BYOF Standalone Functionality", function () {
  this.timeout(10000);

  describe("getMooseClients", () => {
    it("should create a client with default configuration", async () => {
      const { client } = await getMooseClients();

      expect(client).to.exist;
      expect(client.query).to.exist;
      expect(client.workflow).to.exist;
    });

    it("should create a client with custom host override", async () => {
      const { client } = await getMooseClients({
        host: "custom-host.example.com",
      });

      expect(client).to.exist;
      expect(client.query).to.exist;
    });

    it("should create a client with partial config override", async () => {
      const { client } = await getMooseClients({
        database: "custom_db",
        port: "9000",
      });

      expect(client).to.exist;
      expect(client.query).to.exist;
    });

    it("should create a client with full config override", async () => {
      const { client } = await getMooseClients({
        host: "test-host",
        port: "8123",
        username: "test_user",
        password: "test_pass",
        database: "test_db",
        useSSL: true,
      });

      expect(client).to.exist;
      expect(client.query).to.exist;
    });

    it("should respect environment variables for config", async () => {
      const originalHost = process.env.MOOSE_CLICKHOUSE_CONFIG__HOST;
      process.env.MOOSE_CLICKHOUSE_CONFIG__HOST = "env-host";

      try {
        const { client } = await getMooseClients();
        expect(client).to.exist;
      } finally {
        if (originalHost !== undefined) {
          process.env.MOOSE_CLICKHOUSE_CONFIG__HOST = originalHost;
        } else {
          delete process.env.MOOSE_CLICKHOUSE_CONFIG__HOST;
        }
      }
    });

    it("should prioritize override params over environment variables", async () => {
      const originalHost = process.env.MOOSE_CLICKHOUSE_CONFIG__HOST;
      process.env.MOOSE_CLICKHOUSE_CONFIG__HOST = "env-host";

      try {
        const { client } = await getMooseClients({
          host: "override-host",
        });
        expect(client).to.exist;
      } finally {
        if (originalHost !== undefined) {
          process.env.MOOSE_CLICKHOUSE_CONFIG__HOST = originalHost;
        } else {
          delete process.env.MOOSE_CLICKHOUSE_CONFIG__HOST;
        }
      }
    });
  });

  describe("sql template tag", () => {
    it("should create a sql query object with values", () => {
      const query = sql`SELECT * FROM test WHERE id = ${123}`;

      expect(query).to.exist;
      expect(query.strings).to.have.lengthOf(2);
      expect(query.values).to.have.lengthOf(1);
      expect(query.values[0]).to.equal(123);
    });

    it("should handle multiple interpolated values", () => {
      const query = sql`SELECT * FROM test WHERE id = ${123} AND name = ${"test"}`;

      expect(query.values).to.have.lengthOf(2);
      expect(query.values[0]).to.equal(123);
      expect(query.values[1]).to.equal("test");
    });

    it("should handle nested sql queries", () => {
      const subQuery = sql`SELECT id FROM users WHERE active = ${true}`;
      const mainQuery = sql`SELECT * FROM orders WHERE user_id IN (${subQuery})`;

      expect(mainQuery).to.exist;
      expect(mainQuery.values).to.include(true);
    });

    it("should handle arrays of values", () => {
      const ids = [1, 2, 3];
      const query = sql`SELECT * FROM test WHERE id = ${ids[0]}`;

      expect(query.values[0]).to.equal(1);
    });

    it("should handle boolean values", () => {
      const query = sql`SELECT * FROM test WHERE active = ${true}`;

      expect(query.values[0]).to.equal(true);
    });

    it("should handle string values with special characters", () => {
      const query = sql`SELECT * FROM test WHERE name = ${"O'Reilly"}`;

      expect(query.values[0]).to.equal("O'Reilly");
    });
  });

  describe("Integration: getMooseClients + sql", () => {
    it("should work together to create queries", async () => {
      const { client } = await getMooseClients();
      const query = sql`SELECT 1 as test`;

      expect(client).to.exist;
      expect(query).to.exist;
      expect(client.query).to.exist;
    });

    it("should create client and sql query with custom config", async () => {
      const { client } = await getMooseClients({
        host: "localhost",
        database: "test_db",
      });

      const testId = 42;
      const query = sql`SELECT * FROM test_table WHERE id = ${testId}`;

      expect(client).to.exist;
      expect(query.values[0]).to.equal(42);
    });
  });
});
