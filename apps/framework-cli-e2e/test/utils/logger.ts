/**
 * E2E Test Logger
 * Provides structured logging with local timestamps for e2e tests
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LoggerConfig {
  level: LogLevel;
  useColor: boolean;
}

class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: config.level ?? LogLevel.INFO,
      useColor: config.useColor ?? true,
    };
  }

  /**
   * Get current timestamp in local time format
   */
  private getTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const ms = String(now.getMilliseconds()).padStart(3, "0");

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  }

  /**
   * Format log message with timestamp and level
   */
  private formatMessage(
    level: string,
    message: string,
    color?: string,
  ): string {
    const timestamp = this.getTimestamp();
    const levelStr = `[${level}]`.padEnd(7);

    if (this.config.useColor && color) {
      return `${color}${timestamp} ${levelStr}${message}\x1b[0m`;
    }

    return `${timestamp} ${levelStr}${message}`;
  }

  /**
   * Format additional data for logging
   */
  private formatData(data?: any): string {
    if (data === undefined) return "";

    if (typeof data === "object") {
      try {
        return "\n" + JSON.stringify(data, null, 2);
      } catch {
        return "\n" + String(data);
      }
    }

    return " " + String(data);
  }

  /**
   * Log debug message (for verbose output)
   */
  debug(message: string, data?: any): void {
    if (this.config.level <= LogLevel.DEBUG) {
      console.log(
        this.formatMessage("DEBUG", message, "\x1b[36m") +
          this.formatData(data),
      );
    }
  }

  /**
   * Log info message
   */
  info(message: string, data?: any): void {
    if (this.config.level <= LogLevel.INFO) {
      console.log(
        this.formatMessage("INFO", message, "\x1b[32m") + this.formatData(data),
      );
    }
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: any): void {
    if (this.config.level <= LogLevel.WARN) {
      console.warn(
        this.formatMessage("WARN", message, "\x1b[33m") + this.formatData(data),
      );
    }
  }

  /**
   * Log error message
   */
  error(message: string, error?: any): void {
    if (this.config.level <= LogLevel.ERROR) {
      const errorDetails =
        error instanceof Error ?
          `\n${error.stack || error.message}`
        : this.formatData(error);

      console.error(
        this.formatMessage("ERROR", message, "\x1b[31m") + errorDetails,
      );
    }
  }

  /**
   * Create a scoped logger with a prefix
   */
  scope(prefix: string): ScopedLogger {
    return new ScopedLogger(this, prefix);
  }

  /**
   * Update logger configuration
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.config.level;
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }
}

/**
 * Scoped logger that adds a prefix to all messages
 */
class ScopedLogger {
  constructor(
    private logger: Logger,
    private prefix: string,
  ) {}

  private addPrefix(message: string): string {
    return `[${this.prefix}] ${message}`;
  }

  debug(message: string, data?: any): void {
    this.logger.debug(this.addPrefix(message), data);
  }

  info(message: string, data?: any): void {
    this.logger.info(this.addPrefix(message), data);
  }

  warn(message: string, data?: any): void {
    this.logger.warn(this.addPrefix(message), data);
  }

  error(message: string, error?: any): void {
    this.logger.error(this.addPrefix(message), error);
  }

  scope(subPrefix: string): ScopedLogger {
    return new ScopedLogger(this.logger, `${this.prefix}:${subPrefix}`);
  }
}

// Create and export singleton logger instance
const logger = new Logger();

// Check for DEBUG environment variable
if (process.env.DEBUG === "true" || process.env.DEBUG === "1") {
  logger.setLevel(LogLevel.DEBUG);
}

export { logger };
export type { ScopedLogger };
