import fs from "fs";
import fetch from "node-fetch";
import { MOOSE_INGEST_URL, DAS_PORT } from "./config.js";
import { BrainwaveData } from "./types.js";
import { createScreen } from "./blessed-setup.js";
import { Logger } from "./logger.js";
import {
  checkExcessiveMovement,
  analyzeRelaxationState,
} from "./brainwave-analyzer.js";
import { DisplayManager } from "./display-manager.js";
import { UDPServer } from "./udp-server.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

console.log("MOOSE_INGEST_URL:", MOOSE_INGEST_URL);

interface Args {
  sessionId: string;
}

const argv = yargs(hideBin(process.argv))
  .option("sessionId", {
    alias: "s",
    description: "Session identifier",
    type: "string",
    default: () => Math.floor(Date.now() / 1000).toString(),
    demandOption: false,
  })
  .help()
  .parse() as Args;

// Create blessed screen and charts
const { screen, line, table, log, bpmBox } = createScreen();

Logger.initialize(log);

let lastRelaxationState = false;
let isFirstReading = true;

let server: UDPServer;
const displayManager = new DisplayManager(screen, line, table, bpmBox);

let lastBPMDisplayTime = 0;
const BPM_DISPLAY_INTERVAL = 5000; // 5 seconds
let latestCalculatedBPM: number | null = null;

const sessionFileName = `./brain_data_${argv.sessionId}-ingest.csv`;
const s = fs.createWriteStream(sessionFileName, { flags: "a" });

/**
 * @description dump object to file
 */
function writeFile(fileName: string, document: BrainwaveData): void {
  // Skip if bandOn is false and all other fields are zero
  const allFieldsZero =
    document.acc.x === 0 &&
    document.acc.y === 0 &&
    document.acc.z === 0 &&
    document.gyro.x === 0 &&
    document.gyro.y === 0 &&
    document.gyro.z === 0 &&
    document.alpha === 0 &&
    document.beta === 0 &&
    document.delta === 0 &&
    document.theta === 0 &&
    document.gamma === 0 &&
    (!document.ppm ||
      (document.ppm.channel1 === 0 &&
        document.ppm.channel2 === 0 &&
        document.ppm.channel3 === 0));

  // Skip if all brainwave bands are zero
  const allBandsZero =
    document.alpha === 0 &&
    document.beta === 0 &&
    document.delta === 0 &&
    document.gamma === 0 &&
    document.theta === 0;

  if ((document.bandOn === false && allFieldsZero) || allBandsZero) {
    // Do not record, display, or send
    return;
  }

  document.sessionId = `${argv.sessionId}`;
  fetch(MOOSE_INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(document),
  }).catch((error) => {
    Logger.error(`Failed to send data to server: ${error.message}`);
  });

  // Check relaxation state
  const relaxationState = analyzeRelaxationState(document);

  // Debug logging
  // Logger.info(`Debug - Current: ${relaxationState.isRelaxed}, Last: ${lastRelaxationState}, Score: ${relaxationState.score.toFixed(2)}`);

  if (
    document.bandOn &&
    (isFirstReading || relaxationState.isRelaxed !== lastRelaxationState)
  ) {
    if (relaxationState.isRelaxed) {
      Logger.info(
        `State changed to relaxed (score: ${relaxationState.score.toFixed(2)})`,
      );
    } else {
      Logger.warn(
        `State changed to active (score: ${relaxationState.score.toFixed(2)})`,
      );
    }
    lastRelaxationState = relaxationState.isRelaxed;
    isFirstReading = false;
  }

  displayManager.updateTable(document);

  s.write(
    `${document.timestamp.toISOString()}` +
      `\t${document.bandOn}` +
      `\t${document.acc.x}` +
      `\t${document.acc.y}` +
      `\t${document.acc.z}` +
      `\t${document.gyro.x}` +
      `\t${document.gyro.y}` +
      `\t${document.gyro.z}` +
      `\t${document.alpha}` +
      `\t${document.beta}` +
      `\t${document.delta}` +
      `\t${document.gamma}` +
      `\t${document.theta}` +
      `\t${document.ppm?.channel1 ?? ""}` +
      `\t${document.ppm?.channel2 ?? ""}` +
      `\t${document.ppm?.channel3 ?? ""}` +
      "\r\n",
  );
  screen.render();
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const serviceName: string = "DAS";
  Logger.initialize(log);
  Logger.info(`Starting ${serviceName} service...`);
  Logger.info(`Session ID: ${argv.sessionId}`);

  const displayManager = new DisplayManager(screen, line, table, bpmBox);

  server = new UDPServer((data: BrainwaveData, bpm?: number | null) => {
    writeFile("./brain_data.csv", data);
    displayManager.updateChart(data);
    displayManager.updateTable(data);
    latestCalculatedBPM = bpm ?? null; // Always store the latest calculated BPM

    const now = Date.now();
    if (now - lastBPMDisplayTime > BPM_DISPLAY_INTERVAL) {
      if (latestCalculatedBPM === null) {
        displayManager.updateBPM(null); // No data or an explicit clear signal
      } else if (latestCalculatedBPM >= 65) {
        displayManager.updateBPM(latestCalculatedBPM); // Good data, update display
      }
      // If latestCalculatedBPM is < 65 (and not null), we do nothing here,
      // so the display manager keeps showing the previous valid BPM.
      lastBPMDisplayTime = now;
    }

    checkExcessiveMovement(data);
  });

  server.start(Number(DAS_PORT));
}

function cleanup() {
  server.close();
  screen.destroy();
  s.end(); // Close the write stream
  process.stdout.write("\x1b[2J\x1b[0f");
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

screen.key(["escape", "q", "C-c"], function (_ch: any, _key: any) {
  cleanup();
});

main().catch((error: Error) => {
  Logger.error(error.message);
});
