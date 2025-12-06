import { ClickHouseClient } from "@clickhouse/client";
import fastq, { queueAsPromised } from "fastq";
import { cliLog, getClickhouseClient } from "../commons";
import { Blocks } from "./helpers";
import fs from "node:fs";
import path from "node:path";

const walkDir = (dir: string, fileExtension: string, fileList: string[]) => {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    if (fs.statSync(path.join(dir, file)).isDirectory()) {
      fileList = walkDir(path.join(dir, file), fileExtension, fileList);
    } else if (file.endsWith(fileExtension)) {
      fileList.push(path.join(dir, file));
    }
  });

  return fileList;
};

interface BlocksQueueTask {
  chClient: ClickHouseClient;
  blocks: Blocks;
  retries: number;
}

interface ClickhouseConfig {
  database: string;
  host: string;
  port: string;
  username: string;
  password: string;
  useSSL: boolean;
}

interface BlocksConfig {
  blocksDir: string;
  clickhouseConfig: ClickhouseConfig;
}

class DependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DependencyError";
  }
}

// Convert our config to Clickhouse client config
const toClientConfig = (config: ClickhouseConfig) => ({
  ...config,
  useSSL: config.useSSL ? "true" : "false",
});

const createBlocks = async (chClient: ClickHouseClient, blocks: Blocks) => {
  for (const query of blocks.setup) {
    try {
      console.log(`Creating block using query ${query}`);
      await chClient.command({
        query,
        clickhouse_settings: {
          wait_end_of_query: 1, // Ensure at least once delivery and DDL acknowledgment
        },
      });
    } catch (err) {
      cliLog({
        action: "Blocks",
        message: `Failed to create blocks: ${err}`,
        message_type: "Error",
      });
      if (err && JSON.stringify(err).includes(`UNKNOWN_TABLE`)) {
        throw new DependencyError(err.toString());
      }
    }
  }
};

const deleteBlocks = async (chClient: ClickHouseClient, blocks: Blocks) => {
  for (const query of blocks.teardown) {
    try {
      console.log(`Deleting block using query ${query}`);
      await chClient.command({
        query,
        clickhouse_settings: {
          wait_end_of_query: 1, // Ensure at least once delivery and DDL acknowledgment
        },
      });
    } catch (err) {
      cliLog({
        action: "Blocks",
        message: `Failed to delete blocks: ${err}`,
        message_type: "Error",
      });
    }
  }
};

const asyncWorker = async (task: BlocksQueueTask) => {
  await deleteBlocks(task.chClient, task.blocks);
  await createBlocks(task.chClient, task.blocks);
};

export const runBlocks = async (config: BlocksConfig) => {
  const chClient = getClickhouseClient(toClientConfig(config.clickhouseConfig));
  console.log(`Connected`);

  const blocksFiles = walkDir(config.blocksDir, ".ts", []);
  const numOfBlockFiles = blocksFiles.length;
  console.log(`Found ${numOfBlockFiles} blocks files`);

  const queue: queueAsPromised<BlocksQueueTask> = fastq.promise(asyncWorker, 1);

  queue.error((err: Error, task: BlocksQueueTask) => {
    if (err && task.retries > 0) {
      if (err instanceof DependencyError) {
        queue.push({ ...task, retries: task.retries - 1 });
      }
    }
  });

  for (const path of blocksFiles) {
    console.log(`Adding to queue: ${path}`);

    try {
      const blocks = require(path).default as Blocks;
      queue.push({
        chClient,
        blocks,
        retries: numOfBlockFiles,
      });
    } catch (err) {
      cliLog({
        action: "Blocks",
        message: `Failed to import blocks from ${path}: ${err}`,
        message_type: "Error",
      });
    }
  }

  while (!queue.idle()) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};
