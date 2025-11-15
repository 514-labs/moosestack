import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Code } from "lucide-react";

type ReasoningSectionProps = {
  part: any; // Reasoning part from AI SDK
};

export function ReasoningSection({ part }: ReasoningSectionProps) {
  const reasoningText =
    part.details
      ?.map((detail: any) =>
        detail.type === "text" ? detail.text : "<redacted>",
      )
      .join("") || "Reasoning content";

  return (
    <div
      className={cn(
        "mt-2 p-3 rounded-lg border",
        "bg-purple-50/50 border-purple-200/50 dark:bg-purple-950/20 dark:border-purple-800/30",
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <Code className="w-4 h-4 text-purple-600 dark:text-purple-400" />
        <Badge variant="secondary" className="text-xs">
          Reasoning
        </Badge>
      </div>
      <div className="text-sm leading-relaxed whitespace-pre-wrap">
        {reasoningText}
      </div>
    </div>
  );
}
