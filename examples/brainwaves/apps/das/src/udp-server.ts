import dgram from "dgram";
import * as oscmin from "osc-min";
import { BrainwaveData } from "./types.js";
import { Logger } from "./logger.js";
import { pcap } from "./utils.js";
import { estimateHeartRateFromPPG } from "./brainwave-analyzer.js";

export class UDPServer {
  private server!: dgram.Socket;
  private msg: BrainwaveData;
  private requestCount = 0;
  private lastRequestLog = Date.now();
  private readonly SAMPLE_LOG_INTERVAL = 5000; // 5 seconds

  // Buffer for PPG data (channel 0)
  private ppgBuffer: { timestamp: number; values: [number, number, number] }[] =
    [];
  private readonly PPG_BUFFER_SECONDS = 15;

  private lastBPM: number | null = null;

  private pendingTimestamp: Date | null = null;

  constructor(
    private onDataUpdate: (data: BrainwaveData, bpm?: number | null) => void,
  ) {
    this.msg = {
      sessionId: "",
      timestamp: new Date(),
      bandOn: false,
      acc: { x: 0, y: 0, z: 0 },
      gyro: { x: 0, y: 0, z: 0 },
      alpha: 0,
      beta: 0,
      delta: 0,
      theta: 0,
      gamma: 0,
      ppm: { channel1: 0, channel2: 0, channel3: 0 },
    };
  }

  start(port: number): void {
    this.server = dgram.createSocket("udp4");

    this.server.on("message", (buffer, _rinfo) => {
      this.handleMessage(buffer);
    });

    this.server.on("listening", () => {
      const address = this.server.address();
      Logger.info(`server listening ${address.address}:${address.port}`);
    });

    this.server.on("error", (err) => {
      Logger.error(`Server error: ${err.message}`);
    });

    this.server.bind(port);
  }

  private handleMessage(buffer: Buffer): void {
    // Log the raw UDP message as a hex+ASCII dump (16 bytes per line)
    const bytes = Array.from(buffer);
    let hexAsciiDump = "\n";
    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.slice(i, i + 16);
      const hex = chunk.map((b) => b.toString(16).padStart(2, "0")).join(" ");
      const ascii = chunk
        .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : "."))
        .join("");
      hexAsciiDump += hex.padEnd(16 * 3) + "  " + ascii + "\n";
    }
    // Logger.info('UDP message hex dump:' + hexAsciiDump);
    this.requestCount++;

    const now = Date.now();
    if (now - this.lastRequestLog >= this.SAMPLE_LOG_INTERVAL) {
      const requestsPerSecond =
        this.requestCount / (this.SAMPLE_LOG_INTERVAL / 1000);
      Logger.info(
        `Sample rate: ${requestsPerSecond.toFixed(2)} samples/second`,
      );
      this.requestCount = 0;
      this.lastRequestLog = now;
    }

    let oscPacket;
    try {
      oscPacket = oscmin.fromBuffer(buffer);
    } catch (e: any) {
      Logger.error(`Error parsing OSC buffer: ${e.message}`);
      Logger.error(`Problematic buffer (hex): ${buffer.toString("hex")}`);
      return; // Stop processing this malformed message
    }

    let address: string | undefined;
    let msgArgs: any[] | undefined;

    if (oscPacket.address) {
      address = oscPacket.address;
      msgArgs = oscPacket.args;
    } else if (
      oscPacket.elements &&
      Array.isArray(oscPacket.elements) &&
      oscPacket.elements[0]
    ) {
      const firstElement = oscPacket.elements[0];
      if (firstElement.address && firstElement.args) {
        address = firstElement.address;
        msgArgs = firstElement.args;
      }
    }

    if (!address || !msgArgs) {
      Logger.warn("Received malformed, empty, or unprocessable OSC packet.");
      Logger.warn(`Original buffer (hex): ${buffer.toString("hex")}`);
      try {
        Logger.warn(`Parsed packet: ${JSON.stringify(oscPacket)}`);
      } catch (jsonError: any) {
        Logger.warn(`Could not stringify parsed packet: ${jsonError.message}`);
      }
      return;
    }

    // Handle timestamp message
    if (
      address === "/muse/timestamp" &&
      msgArgs.length > 0 &&
      msgArgs[0].value
    ) {
      // Accept ISO string or epoch ms
      const val = msgArgs[0].value;
      let ts: Date | null = null;
      if (typeof val === "string") {
        ts = new Date(val);
      } else if (typeof val === "number") {
        ts = new Date(val);
      }
      if (ts && !isNaN(ts.getTime())) {
        this.pendingTimestamp = ts;
      } else {
        Logger.warn(`Invalid timestamp received: ${val}`);
      }
      return; // Don't process further for timestamp-only messages
    }

    const type = address;
    const bpm = this.updateMessageData(type, msgArgs);
    // Use pendingTimestamp if set, otherwise use current time
    this.msg.timestamp = this.pendingTimestamp || new Date();
    this.pendingTimestamp = null; // Reset after use

    // Filtering logic: skip if bandOn is false and all other fields are zero, or if all bands are zero
    const allFieldsZero =
      this.msg.acc.x === 0 &&
      this.msg.acc.y === 0 &&
      this.msg.acc.z === 0 &&
      this.msg.gyro.x === 0 &&
      this.msg.gyro.y === 0 &&
      this.msg.gyro.z === 0 &&
      this.msg.alpha === 0 &&
      this.msg.beta === 0 &&
      this.msg.delta === 0 &&
      this.msg.theta === 0 &&
      this.msg.gamma === 0 &&
      (!this.msg.ppm ||
        (this.msg.ppm.channel1 === 0 &&
          this.msg.ppm.channel2 === 0 &&
          this.msg.ppm.channel3 === 0));

    const allBandsZero =
      this.msg.alpha === 0 &&
      this.msg.beta === 0 &&
      this.msg.delta === 0 &&
      this.msg.gamma === 0 &&
      this.msg.theta === 0;

    if ((this.msg.bandOn === false && allFieldsZero) || allBandsZero) {
      // Do not process invalid data
      return;
    }

    this.onDataUpdate(this.msg, bpm);
  }

  private updateMessageData(type: string, args: any[]): number | null {
    if (type.includes("touching_forehead")) {
      const newBandState = args[0].value === 1;
      if (newBandState !== this.msg.bandOn) {
        if (newBandState) {
          Logger.info("Band state changed from OFF to ON");
        } else {
          Logger.warn("Band state changed from ON to OFF");
        }
      }
      this.msg.bandOn = newBandState;
    }
    if (type.includes("gyro")) {
      this.msg.gyro = {
        x: pcap(args[0].value),
        y: pcap(args[1].value),
        z: pcap(args[2].value),
      };
    }
    if (type.includes("acc")) {
      this.msg.acc = {
        x: pcap(args[0].value),
        y: pcap(args[1].value),
        z: pcap(args[2].value),
      };
    }
    if (type.includes("alpha")) this.msg.alpha = pcap(args[0].value);
    if (type.includes("beta")) this.msg.beta = pcap(args[0].value);
    if (type.includes("delta")) this.msg.delta = pcap(args[0].value);
    if (type.includes("theta")) this.msg.theta = pcap(args[0].value);
    if (type.includes("gamma")) this.msg.gamma = pcap(args[0].value);
    if (type.includes("ppg")) {
      // Ensure ppm object exists
      if (!this.msg.ppm) {
        this.msg.ppm = { channel1: 0, channel2: 0, channel3: 0 };
      }
      // Ensure there are three channels of data for PPG
      if (args && args.length >= 3 && args[0] && args[1] && args[2]) {
        this.msg.ppm.channel1 = args[0].value;
        this.msg.ppm.channel2 = args[1].value;
        this.msg.ppm.channel3 = args[2].value;
      } else {
        this.msg.ppm.channel1 = 0;
        this.msg.ppm.channel2 = 0;
        this.msg.ppm.channel3 = 0;
        Logger.warn(
          `[PPG Data] Received malformed PPG data, clearing PPM channels: ${JSON.stringify(args)}`,
        );
      }

      const now = Date.now() / 1000; // seconds
      // Ensure there are three channels of data
      if (args && args.length >= 3 && args[0] && args[1] && args[2]) {
        this.ppgBuffer.push({
          timestamp: now,
          values: [args[0].value, args[1].value, args[2].value],
        });
      } else {
        Logger.warn(
          `[PPG Data] Received malformed PPG data: ${JSON.stringify(args)}`,
        );
        // Push zeros or handle as an error, for now, skipping if malformed
        // Or push a default structure if you prefer to always have an entry:
        // this.ppgBuffer.push({ timestamp: now, values: [0, 0, 0] });
        // For now, just log and skip if data is not as expected.
        return this.lastBPM; // Or handle error appropriately
      }

      // Log the entire args array for PPG messages to inspect its structure
      Logger.info(`[PPG Data] Received args: ${JSON.stringify(args)}`);

      // Remove old samples
      while (
        this.ppgBuffer.length > 0 &&
        now - this.ppgBuffer[0].timestamp > this.PPG_BUFFER_SECONDS
      ) {
        this.ppgBuffer.shift();
      }

      // Estimate heart rate
      const bpm = estimateHeartRateFromPPG(this.ppgBuffer);
      if (bpm) {
        Logger.info(`Estimated Heart Rate: ${bpm.toFixed(1)} BPM`);
        this.lastBPM = bpm;
        return bpm;
      } else {
        Logger.info("No plausible heart rate");
      }
      return this.lastBPM;
    }
    return this.lastBPM;
  }

  close(): void {
    if (this.server) {
      this.server.close();
    }
  }
}
