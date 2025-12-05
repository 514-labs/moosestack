import { expect } from "chai";
import {
  getSourceLocationFromStack,
  getSourceFileFromStack,
} from "../src/dmv2/utils/stackTrace";

describe("getSourceLocationFromStack", () => {
  it("parses V8 stack trace format", () => {
    const stack = `Error: test
    at Object.<anonymous> (/path/to/file.ts:10:15)
    at Module._compile (internal/modules/cjs/loader.js:1085:14)`;

    const location = getSourceLocationFromStack(stack);

    expect(location).to.deep.equal({
      file: "/path/to/file.ts",
      line: 10,
      column: 15,
    });
  });

  it("parses V8 stack trace with function name", () => {
    const stack = `Error: test
    at functionName (/path/to/file.ts:25:8)
    at Module._compile (internal/modules/cjs/loader.js:1085:14)`;

    const location = getSourceLocationFromStack(stack);

    expect(location).to.deep.equal({
      file: "/path/to/file.ts",
      line: 25,
      column: 8,
    });
  });

  it("skips node_modules frames", () => {
    const stack = `Error: test
    at Object.<anonymous> (/path/to/node_modules/some-lib/index.js:5:10)
    at userCode (/path/to/app/views/myView.ts:20:5)`;

    const location = getSourceLocationFromStack(stack);

    expect(location?.file).to.equal("/path/to/app/views/myView.ts");
    expect(location?.line).to.equal(20);
    expect(location?.column).to.equal(5);
  });

  it("skips moose-lib internal frames", () => {
    const stack = `Error: test
    at SqlResource (/path/to/node_modules/@514labs/moose-lib/dist/dmv2/sdk/sqlResource.js:15:10)
    at new MaterializedView (/path/to/app/views/myView.ts:25:12)`;

    const location = getSourceLocationFromStack(stack);

    expect(location?.file).to.contain("app/views/myView.ts");
    expect(location?.line).to.equal(25);
    expect(location?.column).to.equal(12);
  });

  it("skips ts-moose-lib development frames (Unix path)", () => {
    const stack = `Error: test
    at SqlResource (/path/to/ts-moose-lib/src/dmv2/sdk/sqlResource.ts:15:10)
    at new MaterializedView (/path/to/app/views/myView.ts:30:7)`;

    const location = getSourceLocationFromStack(stack);

    expect(location?.file).to.contain("app/views/myView.ts");
    expect(location?.line).to.equal(30);
    expect(location?.column).to.equal(7);
  });

  it("skips ts-moose-lib development frames (Windows path)", () => {
    const stack = `Error: test
    at SqlResource (C:\\path\\to\\ts-moose-lib\\src\\dmv2\\sdk\\sqlResource.ts:15:10)
    at new MaterializedView (C:\\path\\to\\app\\views\\myView.ts:30:7)`;

    const location = getSourceLocationFromStack(stack);

    expect(location?.file).to.contain("app\\views\\myView.ts");
    expect(location?.line).to.equal(30);
    expect(location?.column).to.equal(7);
  });

  it("returns undefined for empty stack", () => {
    expect(getSourceLocationFromStack(undefined)).to.be.undefined;
    expect(getSourceLocationFromStack("")).to.be.undefined;
  });

  it("returns undefined when no user code frames found", () => {
    const stack = `Error: test
    at Module._compile (internal/modules/cjs/loader.js:1085:14)
    at Object.Module._extensions..js (internal/modules/cjs/loader.js:1114:10)`;

    const location = getSourceLocationFromStack(stack);

    expect(location).to.be.undefined;
  });

  it("parses SpiderMonkey format", () => {
    const stack = `Error: test
functionName@/path/to/file.ts:15:20
anotherFunction@/path/to/other.ts:10:5`;

    const location = getSourceLocationFromStack(stack);

    expect(location).to.deep.equal({
      file: "/path/to/file.ts",
      line: 15,
      column: 20,
    });
  });

  it("handles stack trace without parentheses", () => {
    const stack = `Error: test
    at /path/to/file.ts:42:3
    at Module._compile (internal/modules/cjs/loader.js:1085:14)`;

    const location = getSourceLocationFromStack(stack);

    expect(location).to.deep.equal({
      file: "/path/to/file.ts",
      line: 42,
      column: 3,
    });
  });
});

describe("getSourceFileFromStack (deprecated)", () => {
  it("returns file path from location", () => {
    const stack = `Error: test
    at Object.<anonymous> (/path/to/file.ts:10:15)
    at Module._compile (internal/modules/cjs/loader.js:1085:14)`;

    const file = getSourceFileFromStack(stack);

    expect(file).to.equal("/path/to/file.ts");
  });

  it("returns undefined for empty stack", () => {
    expect(getSourceFileFromStack(undefined)).to.be.undefined;
    expect(getSourceFileFromStack("")).to.be.undefined;
  });

  it("maintains backward compatibility with old behavior", () => {
    const stack = `Error: test
    at userCode (/path/to/app/myFile.ts:20:5)`;

    const file = getSourceFileFromStack(stack);

    expect(file).to.equal("/path/to/app/myFile.ts");
  });
});
