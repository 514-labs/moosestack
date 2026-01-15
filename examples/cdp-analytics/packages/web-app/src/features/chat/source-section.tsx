type SourceSectionProps = {
  part: any; // Source part from AI SDK
};

export function SourceSection({ part }: SourceSectionProps) {
  const title =
    part.source?.title ||
    (part.source?.url ? new URL(part.source.url).hostname : "Source");

  return (
    <div className="mt-2">
      <a
        href={part.source?.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
      >
        [{title}]
      </a>
    </div>
  );
}
