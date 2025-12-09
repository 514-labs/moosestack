import { describe, it } from "mocha";
import { expect } from "chai";
import { OlapTable } from "../src/dmv2/sdk/olapTable";

interface SampleModel {
  id: string;
  name: string;
}

describe("Metadata handling", () => {
  it("should respect user-provided source file path", () => {
    const userProvidedPath = "custom/path/to/model.ts";

    const table = new OlapTable<SampleModel>("test_user_provided", {
      metadata: {
        source: {
          file: userProvidedPath,
        },
      },
    } as any);

    expect(table.metadata).to.exist;
    expect(table.metadata.source).to.exist;
    expect(table.metadata.source?.file).to.equal(userProvidedPath);
  });

  it("should respect user-provided metadata while auto-capturing source", () => {
    const table = new OlapTable<SampleModel>("test_preserve_metadata", {
      metadata: {
        description: "A test table",
      },
    } as any);

    expect(table.metadata).to.exist;
    expect(table.metadata.description).to.equal("A test table");
    expect(table.metadata.source).to.exist;
    expect(table.metadata.source?.file).to.include("metadata.test.ts");
  });
});
