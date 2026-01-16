import { MDXRenderer } from "@/components/mdx-renderer";

interface StepContentProps {
  content: string;
  isMDX: boolean;
}

export async function StepContent({ content, isMDX }: StepContentProps) {
  if (!content) {
    return (
      <div className="text-muted-foreground">Step content not available</div>
    );
  }

  return (
    <div className="prose prose-base md:prose-lg dark:prose-invert w-full">
      {isMDX ?
        <MDXRenderer source={content} />
      : <div dangerouslySetInnerHTML={{ __html: content }} />}
    </div>
  );
}
