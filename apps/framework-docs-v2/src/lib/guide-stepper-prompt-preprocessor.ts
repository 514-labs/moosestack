/**
 * Preprocessor for GuideStepper prompt-copy support.
 *
 * Injects `rawContent` into:
 * - <GuideStepper.Prompt>...</GuideStepper.Prompt>
 * - <GuideStepper.Checkpoint>...</GuideStepper.Checkpoint>
 *
 * The raw markdown content is later concatenated in the GuideStepper UI and
 * copied as the Copilot prompt.
 */

const GUIDE_STEPPER_BLOCK_REGEX =
  /<GuideStepper\.(Checkpoint|Prompt)\b([^>]*)>([\s\S]*?)<\/GuideStepper\.\1>/g;

interface Range {
  start: number;
  end: number;
}

function getCodeFenceRanges(content: string): Range[] {
  const ranges: Range[] = [];
  const lines = content.split("\n");

  let inCodeBlock = false;
  let codeBlockChar = "";
  let codeBlockLength = 0;
  let blockStartOffset = 0;
  let offset = 0;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s{0,3}([`~]{3,})/);

    if (fenceMatch?.[1]) {
      const fenceDelimiter = fenceMatch[1];
      const fenceChar = fenceDelimiter[0] ?? "";
      const fenceLength = fenceDelimiter.length;

      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockChar = fenceChar;
        codeBlockLength = fenceLength;
        blockStartOffset = offset;
      } else {
        const fullMatchLength = fenceMatch[0].length;
        const restOfLine = line.substring(fullMatchLength);
        const hasInfoString = restOfLine.trim().length > 0;

        if (
          fenceChar === codeBlockChar &&
          fenceLength >= codeBlockLength &&
          !hasInfoString
        ) {
          inCodeBlock = false;
          ranges.push({ start: blockStartOffset, end: offset + line.length });
          codeBlockChar = "";
          codeBlockLength = 0;
        }
      }
    }

    offset += line.length + 1;
  }

  return ranges;
}

export function processGuideStepperPrompts(content: string): string {
  let result = content;
  const codeFenceRanges = getCodeFenceRanges(content);

  const matches = [...content.matchAll(GUIDE_STEPPER_BLOCK_REGEX)];

  for (const match of matches) {
    const matchIndex = match.index ?? -1;
    const isInsideCodeFence = codeFenceRanges.some(
      (range) => matchIndex >= range.start && matchIndex <= range.end,
    );

    if (isInsideCodeFence) {
      continue;
    }

    const fullBlock = match[0];
    const componentName = match[1] as "Checkpoint" | "Prompt";
    const propsString = match[2] ?? "";
    const innerContent = match[3] ?? "";

    if (/\brawContent\s*=/.test(propsString)) {
      continue;
    }

    const rawContent = innerContent.trim();
    const rawContentProp = `rawContent={${JSON.stringify(rawContent)}}`;
    const trimmedProps = propsString.trim();
    const rebuiltOpeningTag =
      trimmedProps.length > 0 ?
        `<GuideStepper.${componentName} ${rawContentProp} ${trimmedProps}>`
      : `<GuideStepper.${componentName} ${rawContentProp}>`;
    const rebuiltBlock = `${rebuiltOpeningTag}${innerContent}</GuideStepper.${componentName}>`;

    result = result.replace(fullBlock, () => rebuiltBlock);
  }

  return result;
}
