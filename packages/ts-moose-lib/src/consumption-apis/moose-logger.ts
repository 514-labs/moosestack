/**
 * Express middleware that logs HTTP requests and responses in the same format
 * as the built-in Moose API logger.
 *
 * This middleware should be added early in the middleware chain to ensure all
 * requests are logged, even if they fail in later middleware or handlers.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { mooseLogger } from '@514labs/moose-lib';
 *
 * const app = express();
 * app.use(mooseLogger);
 * ```
 */
export function mooseLogger(req: any, res: any, next: any): void {
  // Store the original res.end to intercept it
  const originalEnd = res.end;

  // Override res.end to log when the response is sent
  res.end = function (this: any, ...args: any[]): any {
    // Log the request and response
    console.log(`${req.method} ${req.url} ${res.statusCode}`);

    // Call the original end method
    return originalEnd.apply(this, args);
  };

  next();
}
