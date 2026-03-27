import type { SourcePart } from "../../types/message-parts";

type SourceSectionProps = {
  part: SourcePart;
};

export function SourceSection({ part }: SourceSectionProps) {
  let title = part.source?.title;
  if (!title && part.source?.url) {
    try {
      title = new URL(part.source.url).hostname;
    } catch {
      title = "Source";
    }
  }

  return (
    <div className="mt-2">
      <a
        href={part.source?.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
      >
        [{title ?? "Source"}]
      </a>
    </div>
  );
}
