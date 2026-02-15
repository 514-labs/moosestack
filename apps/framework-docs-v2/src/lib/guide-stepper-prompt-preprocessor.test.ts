import { describe, expect, it } from "vitest";
import { processGuideStepperPrompts } from "./guide-stepper-prompt-preprocessor";

describe("processGuideStepperPrompts", () => {
  it("injects rawContent into GuideStepper.Checkpoint blocks", () => {
    const input = `
<GuideStepper.Checkpoint id="phase-1" title="Run Phase 1 checkpoints">
### Checkpoint 1

Do the thing.
</GuideStepper.Checkpoint>
`;

    const output = processGuideStepperPrompts(input);

    expect(output).toContain("<GuideStepper.Checkpoint");
    expect(output).toContain("rawContent={");
    expect(output).toContain("### Checkpoint 1");
  });

  it("does not inject rawContent into GuideStepper.WhatYouNeed blocks", () => {
    const input = `
<GuideStepper.WhatYouNeed>
Attach these files:

- \`context-map.md\`
- \`handler.ts\`
</GuideStepper.WhatYouNeed>
`;

    const output = processGuideStepperPrompts(input);

    expect(output).toContain("<GuideStepper.WhatYouNeed>");
    expect(output).not.toContain("rawContent={");
    expect(output).toContain("Attach these files:");
  });

  it("injects rawContent into GuideStepper.Prompt blocks", () => {
    const input = `
<GuideStepper.Prompt>
Use concise bullets and include file paths.
</GuideStepper.Prompt>
`;

    const output = processGuideStepperPrompts(input);

    expect(output).toContain("<GuideStepper.Prompt");
    expect(output).toContain("rawContent={");
    expect(output).toContain("Use concise bullets and include file paths.");
  });

  it("does not overwrite existing rawContent props", () => {
    const input = `
<GuideStepper.Checkpoint rawContent={"existing"} id="phase-1" title="Run checkpoints">
### Checkpoint 1
</GuideStepper.Checkpoint>
`;

    const output = processGuideStepperPrompts(input);

    expect(output).toContain('rawContent={"existing"}');
    expect(output).not.toContain('rawContent={"### Checkpoint 1"}');
  });

  it("does not inject rawContent into code-fence examples", () => {
    const input = `
\`\`\`mdx
<GuideStepper.Checkpoint id="phase-1" title="Run checkpoints">
### Checkpoint 1
</GuideStepper.Checkpoint>
\`\`\`
`;

    const output = processGuideStepperPrompts(input);

    expect(output).not.toContain('rawContent={"### Checkpoint 1"}');
    expect(output).toContain('<GuideStepper.Checkpoint id="phase-1"');
  });

  it("injects rawContent for repeated identical blocks", () => {
    const input = `
<GuideStepper.Checkpoint id="phase-1" title="Run checkpoints">
### Checkpoint 1
</GuideStepper.Checkpoint>

<GuideStepper.Checkpoint id="phase-1" title="Run checkpoints">
### Checkpoint 1
</GuideStepper.Checkpoint>
`;

    const output = processGuideStepperPrompts(input);
    const rawContentMatches = output.match(/rawContent=\{/g) ?? [];

    expect(rawContentMatches).toHaveLength(2);
  });
});
