import * as fs from "fs";
import * as path from "path";
import { RETRY_CONFIG } from "../constants";
import { withRetries } from "./retry-utils";

/**
 * Verifies that expected output appears in consumer logs
 */
export const verifyConsumerLogs = async (
  projectDir: string,
  expectedOutput: string[],
): Promise<void> => {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const mooseDir = path.join(homeDir, ".moose");
  const today = new Date();
  const logFileName = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}-cli.log`;
  let logPath = path.join(mooseDir, logFileName);

  await withRetries(
    async () => {
      if (!fs.existsSync(logPath)) {
        // Fallback: pick the most recent cli.log in ~/.moose
        const files = fs
          .readdirSync(mooseDir)
          .filter((f) => f.endsWith("-cli.log"))
          .map((f) => ({
            name: f,
            time: fs.statSync(path.join(mooseDir, f)).mtimeMs,
          }))
          .sort((a, b) => b.time - a.time);
        if (files.length > 0) {
          logPath = path.join(mooseDir, files[0].name);
        }
      }

      console.log("Checking consumer logs in:", logPath);
      const logContent = fs.readFileSync(logPath, "utf-8");
      for (const expected of expectedOutput) {
        if (!logContent.includes(expected)) {
          throw new Error(`Log should contain "${expected}"`);
        }
      }
    },
    {
      attempts: RETRY_CONFIG.LOG_VERIFICATION_ATTEMPTS,
      delayMs: RETRY_CONFIG.LOG_VERIFICATION_DELAY_MS,
    },
  );
};
