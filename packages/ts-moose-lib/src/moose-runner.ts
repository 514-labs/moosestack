#!/usr/bin/env node

// This file is used to run the proper runners for moose based on the
// arguments passed to the file.
// It loads pre-compiled JavaScript - no ts-node required.

import { readFileSync } from "fs";
import { join } from "path";

import { dumpMooseInternal } from "./dmv2/internal";
import { runApis } from "./consumption-apis/runner";
import { runStreamingFunctions } from "./streaming-functions/runner";
import { runExportSerializer } from "./moduleExportSerializer";
import { runScripts } from "./scripts/runner";

import { Command } from "commander";

import type { StreamingFunctionArgs } from "./streaming-functions/runner";

const packageJson = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

const program = new Command();

program
  .name("moose-runner")
  .description("Moose runner for various operations")
  .version(packageJson.version);

program
  .command("print-version")
  .description("Print the installed moose-lib version")
  .action(() => {
    process.stdout.write(packageJson.version);
  });

program
  .command("dmv2-serializer")
  .description("Load DMv2 index")
  .action(async () => {
    await dumpMooseInternal();
  });

program
  .command("export-serializer")
  .description("Run export serializer")
  .argument("<target-model>", "Target model to serialize")
  .action(async (targetModel) => {
    await runExportSerializer(targetModel);
  });

program
  .command("consumption-apis")
  .description("Run consumption APIs")
  .argument("<clickhouse-db>", "Clickhouse database name")
  .argument("<clickhouse-host>", "Clickhouse host")
  .argument("<clickhouse-port>", "Clickhouse port")
  .argument("<clickhouse-username>", "Clickhouse username")
  .argument("<clickhouse-password>", "Clickhouse password")
  .option("--clickhouse-use-ssl", "Use SSL for Clickhouse connection", false)
  .option("--jwt-secret <secret>", "JWT public key for verification")
  .option("--jwt-issuer <issuer>", "Expected JWT issuer")
  .option("--jwt-audience <audience>", "Expected JWT audience")
  .option(
    "--enforce-auth",
    "Enforce authentication on all consumption APIs",
    false,
  )
  .option("--temporal-url <url>", "Temporal server URL")
  .option("--temporal-namespace <namespace>", "Temporal namespace")
  .option("--client-cert <path>", "Path to client certificate")
  .option("--client-key <path>", "Path to client key")
  .option("--api-key <key>", "API key for authentication")
  .option("--proxy-port <port>", "Port to run the proxy server on", parseInt)
  .option(
    "--worker-count <count>",
    "Number of worker processes for the consumption API cluster",
    parseInt,
  )
  .option(
    "--row-policies <json>",
    "JSON map of ClickHouse setting names to JWT claim names for row policy enforcement",
  )
  .option("--rls-user <user>", "ClickHouse username for RLS queries")
  .option("--rls-password <password>", "ClickHouse password for RLS queries")
  .action(
    (
      clickhouseDb,
      clickhouseHost,
      clickhousePort,
      clickhouseUsername,
      clickhousePassword,
      options,
    ) => {
      runApis({
        clickhouseConfig: {
          database: clickhouseDb,
          host: clickhouseHost,
          port: clickhousePort,
          username: clickhouseUsername,
          password: clickhousePassword,
          useSSL: options.clickhouseUseSsl,
          rlsUser: options.rlsUser,
          rlsPassword: options.rlsPassword,
        },
        jwtConfig: {
          secret: options.jwtSecret,
          issuer: options.jwtIssuer,
          audience: options.jwtAudience,
        },
        temporalConfig:
          options.temporalUrl ?
            {
              url: options.temporalUrl,
              namespace: options.temporalNamespace,
              clientCert: options.clientCert,
              clientKey: options.clientKey,
              apiKey: options.apiKey,
            }
          : undefined,
        enforceAuth: options.enforceAuth,
        proxyPort: options.proxyPort,
        workerCount: options.workerCount,
        rowPoliciesConfig:
          options.rowPolicies ?
            (() => {
              let parsed: unknown;
              try {
                parsed = JSON.parse(options.rowPolicies);
              } catch (e) {
                console.error(
                  `Failed to parse --row-policies JSON: ${(e as Error).message}`,
                );
                process.exit(1);
              }
              if (
                typeof parsed !== "object" ||
                parsed === null ||
                Array.isArray(parsed) ||
                !Object.values(parsed as Record<string, unknown>).every(
                  (v) => typeof v === "string",
                )
              ) {
                console.error(
                  `Invalid --row-policies JSON: expected a flat object with string values`,
                );
                process.exit(1);
              }
              return parsed as Record<string, string>;
            })()
          : undefined,
      });
    },
  );

program
  .command("streaming-functions")
  .description("Run streaming functions")
  .argument("<source-topic>", "Source topic configuration as JSON")
  .argument("<function-file-path>", "Path to the function file")
  .argument(
    "<broker>",
    "Kafka broker address(es) - comma-separated for multiple brokers (e.g., 'broker1:9092, broker2:9092'). Whitespace around commas is automatically trimmed.",
  )
  .argument("<max-subscriber-count>", "Maximum number of subscribers")
  .option("--target-topic <target-topic>", "Target topic configuration as JSON")
  .option(
    "--dlq-topic <dlq-topic>",
    "Dead letter queue topic configuration as JSON",
  )
  .option("--sasl-username <username>", "SASL username")
  .option("--sasl-password <password>", "SASL password")
  .option("--sasl-mechanism <mechanism>", "SASL mechanism")
  .option("--security-protocol <protocol>", "Security protocol")
  .option("--log-payloads", "Log payloads for debugging", false)
  .action(
    (sourceTopic, functionFilePath, broker, maxSubscriberCount, options) => {
      const config: StreamingFunctionArgs = {
        sourceTopic: JSON.parse(sourceTopic),
        targetTopic:
          options.targetTopic ? JSON.parse(options.targetTopic) : undefined,
        dlqTopic: options.dlqTopic ? JSON.parse(options.dlqTopic) : undefined,
        functionFilePath,
        broker,
        maxSubscriberCount: parseInt(maxSubscriberCount),
        logPayloads: options.logPayloads,
        saslUsername: options.saslUsername,
        saslPassword: options.saslPassword,
        saslMechanism: options.saslMechanism,
        securityProtocol: options.securityProtocol,
      };
      runStreamingFunctions(config);
    },
  );

program
  .command("scripts")
  .description("Run scripts")
  .option("--temporal-url <url>", "Temporal server URL")
  .option("--temporal-namespace <namespace>", "Temporal namespace")
  .option("--client-cert <path>", "Path to client certificate")
  .option("--client-key <path>", "Path to client key")
  .option("--api-key <key>", "API key for authentication")
  .action((options) => {
    runScripts({
      temporalConfig:
        options.temporalUrl ?
          {
            url: options.temporalUrl,
            namespace: options.temporalNamespace,
            clientCert: options.clientCert,
            clientKey: options.clientKey,
            apiKey: options.apiKey,
          }
        : undefined,
    });
  });

program.parse();
