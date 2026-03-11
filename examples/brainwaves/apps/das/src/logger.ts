import fs from "fs";

export class Logger {
  private static log: any;
  private static fileStream: fs.WriteStream | null = null;

  public static initialize(logComponent: any) {
    this.log = logComponent;
    if (!this.fileStream) {
      // Open das.log in append mode
      this.fileStream = fs.createWriteStream("das.log", { flags: "a" });
    }
  }

  private static writeToFile(level: string, message: string) {
    if (this.fileStream) {
      const timestamp = new Date().toISOString();
      this.fileStream.write(`[${timestamp}] ${level}: ${message}\n`);
    }
  }

  public static info(message: string) {
    const timestamp = new Date().toISOString();
    this.log.log(`\x1b[32m[${timestamp}] INFO: ${message}\x1b[0m`);
    this.writeToFile("INFO", message);
  }

  public static error(message: string) {
    const timestamp = new Date().toISOString();
    this.log.log(`\x1b[31m[${timestamp}] ERROR: ${message}\x1b[0m`);
    this.writeToFile("ERROR", message);
  }

  public static warn(message: string) {
    const timestamp = new Date().toISOString();
    this.log.log(`\x1b[33m[${timestamp}] WARN: ${message}\x1b[0m`);
    this.writeToFile("WARN", message);
  }
}
