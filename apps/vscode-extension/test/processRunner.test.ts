import assert from "node:assert/strict";
import test from "node:test";

import { runProcess } from "../src/processRunner";

test("runProcess forwards stdin to the child process", async () => {
  const result = await runProcess(
    process.execPath,
    [
      "-e",
      "let data=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (chunk) => data += chunk); process.stdin.on('end', () => process.stdout.write(data));",
    ],
    {
      stdin: "hello from stdin",
    },
  );

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "hello from stdin");
  assert.equal(result.timedOut, false);
});

test("runProcess marks commands that exceed the timeout", async () => {
  const result = await runProcess(
    process.execPath,
    ["-e", "setTimeout(() => undefined, 1_000);"],
    {
      timeoutMs: 50,
    },
  );

  assert.equal(result.timedOut, true);
  assert.notEqual(result.signal, null);
});

test("runProcess merges custom env values with the parent environment", async () => {
  const result = await runProcess(
    process.execPath,
    [
      "-e",
      "process.stdout.write(JSON.stringify({ foo: process.env.FOO, hasPath: Boolean(process.env.PATH) }));",
    ],
    {
      env: {
        FOO: "bar",
      },
    },
  );

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    foo: "bar",
    hasPath: true,
  });
});
