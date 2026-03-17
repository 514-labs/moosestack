// Usage: node dist/send-csv-to-udp.js --file=brain_data_*.csv --host=127.0.0.1 --port=43134
import fs from "fs";
import readline from "readline";
import dgram from "dgram";
import * as osc from "osc-min";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

interface Args {
  file: string;
  host: string;
  port: number;
  interval: number;
}

const argv = yargs(hideBin(process.argv))
  .option("file", {
    alias: "f",
    demandOption: true,
    describe: "Path to brain_data CSV file",
    type: "string",
  })
  .option("host", {
    alias: "h",
    default: "127.0.0.1",
    describe: "UDP host",
    type: "string",
  })
  .option("port", {
    alias: "p",
    default: 43134,
    describe: "UDP port",
    type: "number",
  })
  .option("interval", {
    alias: "i",
    default: 20,
    describe: "Delay between rows (ms)",
    type: "number",
  })
  .help().argv as Args;

const client = dgram.createSocket("udp4");

function sendOsc(address: string, args: any[]): void {
  // osc-min returns DataView, but dgram expects Buffer
  const dv = osc.toBuffer({ address, args });
  const buf = Buffer.from(dv.buffer, dv.byteOffset, dv.byteLength);
  client.send(buf, 0, buf.length, argv.port, argv.host);
}

async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: fs.createReadStream(argv.file),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    // CSV columns: timestamp, bandOn, acc.x, acc.y, acc.z, gyro.x, gyro.y, gyro.z, alpha, beta, delta, gamma, theta, ppm1, ppm2, ppm3
    const columns = line.split("\t");
    if (columns.length < 16) {
      // Ensure we have enough columns for PPM data
      console.warn(
        "Skipping CSV line with insufficient columns for PPM data:",
        line,
      );
      continue;
    }

    const [
      timestamp,
      bandOn,
      accX,
      accY,
      accZ,
      gyroX,
      gyroY,
      gyroZ,
      alpha,
      beta,
      delta,
      gamma,
      theta,
      ppm1, // New: ppmchannel1
      ppm2, // New: ppmchannel2
      ppm3, // New: ppmchannel3
    ] = columns;

    // Parse all numeric values
    const nums = [
      accX,
      accY,
      accZ,
      gyroX,
      gyroY,
      gyroZ,
      alpha,
      beta,
      delta,
      gamma,
      theta,
      ppm1, // New
      ppm2, // New
      ppm3, // New
    ].map(parseFloat);

    if (nums.some((n) => isNaN(n))) {
      console.warn(
        "Skipping malformed CSV line (some numeric fields are NaN):",
        line,
      );
      continue;
    }

    // Send timestamp as an OSC message (ISO string)
    sendOsc("/muse/timestamp", [{ type: "string", value: timestamp }]);
    // Send OSC messages for each field as DAS expects
    sendOsc("/muse/elements/touching_forehead", [
      { type: "integer", value: bandOn === "true" ? 1 : 0 },
    ]);
    sendOsc("/muse/acc", [nums[0], nums[1], nums[2]]);
    sendOsc("/muse/gyro", [nums[3], nums[4], nums[5]]);
    sendOsc("/muse/elements/alpha_absolute", [nums[6]]);
    sendOsc("/muse/elements/beta_absolute", [nums[7]]);
    sendOsc("/muse/elements/delta_absolute", [nums[8]]);
    sendOsc("/muse/elements/gamma_absolute", [nums[9]]);
    sendOsc("/muse/elements/theta_absolute", [nums[10]]);
    sendOsc("/muse/elements/ppg", [
      { type: "float", value: nums[11] },
      { type: "float", value: nums[12] },
      { type: "float", value: nums[13] },
    ]);

    await new Promise((res) => setTimeout(res, argv.interval));
  }
  client.close();
  console.log("Finished sending all data.");
}

main();
