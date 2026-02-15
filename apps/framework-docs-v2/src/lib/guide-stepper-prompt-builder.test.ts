import { describe, expect, it } from "vitest";
import { buildGuideStepPromptMarkdown } from "./guide-stepper-prompt-builder";

describe("buildGuideStepPromptMarkdown", () => {
  it("includes checkpoint titles in the assembled prompt", () => {
    const output = buildGuideStepPromptMarkdown({
      promptRawContents: [],
      checkpoints: [
        {
          title: "Verify CDC Status",
          rawContent: "Run the status command and confirm no lag.",
        },
      ],
    });

    expect(output).toContain("Verify CDC Status");
    expect(output).toContain("Run the status command and confirm no lag.");
  });

  it("does not duplicate title when checkpoint content already starts with a matching heading", () => {
    const output = buildGuideStepPromptMarkdown({
      promptRawContents: [],
      checkpoints: [
        {
          title: "Verify CDC Status",
          rawContent:
            "### Verify CDC Status\n\nRun the status command and confirm no lag.",
        },
      ],
    });

    expect(output.match(/### Verify CDC Status/g)).toHaveLength(1);
  });
});
