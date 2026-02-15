export interface GuideStepperPromptCheckpoint {
  rawContent?: string;
  title?: string;
}

interface BuildGuideStepPromptMarkdownParams {
  promptRawContents: string[];
  checkpoints: GuideStepperPromptCheckpoint[];
}

function getLeadingHeadingText(markdown: string): string | null {
  const firstNonEmptyLine = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstNonEmptyLine) {
    return null;
  }

  const headingMatch = firstNonEmptyLine.match(/^#{1,6}\s+(.+)$/);
  if (!headingMatch?.[1]) {
    return null;
  }

  return headingMatch[1].trim();
}

function buildCheckpointPromptSegment(
  checkpoint: GuideStepperPromptCheckpoint,
): string {
  const title = checkpoint.title?.trim() ?? "";
  const rawContent = checkpoint.rawContent?.trim() ?? "";

  if (title.length === 0) return rawContent;
  if (rawContent.length === 0) return `### ${title}`;

  const leadingHeadingText = getLeadingHeadingText(rawContent);
  if (
    leadingHeadingText &&
    leadingHeadingText.localeCompare(title, undefined, {
      sensitivity: "accent",
    }) === 0
  ) {
    return rawContent;
  }

  return `### ${title}\n\n${rawContent}`;
}

export function buildGuideStepPromptMarkdown({
  promptRawContents,
  checkpoints,
}: BuildGuideStepPromptMarkdownParams): string {
  const systemPromptSegments = promptRawContents
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const checkpointSegments = checkpoints
    .map(buildCheckpointPromptSegment)
    .filter((segment) => segment.length > 0);

  if (systemPromptSegments.length === 0) {
    return checkpointSegments.join("\n\n");
  }

  const systemPromptSection = systemPromptSegments.join("\n\n");

  if (checkpointSegments.length === 0) {
    return systemPromptSection;
  }

  return `${systemPromptSection}\n\n-------------\n\n${checkpointSegments.join("\n\n")}`;
}
