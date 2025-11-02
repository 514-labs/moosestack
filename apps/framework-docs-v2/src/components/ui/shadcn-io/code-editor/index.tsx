"use client";

import * as React from "react";
import { useInView, type UseInViewOptions } from "motion/react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconCopy, IconCheck } from "@tabler/icons-react";

type CopyButtonProps = {
  content: string;
  size?: "sm" | "default" | "lg";
  variant?: "default" | "ghost" | "outline";
  className?: string;
  onCopy?: (content: string) => void;
};

function CopyButton({
  content,
  size = "default",
  variant = "default",
  className,
  onCopy,
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      onCopy?.(content);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  return (
    <Button
      size={size}
      variant={variant}
      onClick={handleCopy}
      className={cn("h-8 w-8 p-0", className)}
    >
      {copied ?
        <IconCheck className="h-3 w-3" />
      : <IconCopy className="h-3 w-3" />}
    </Button>
  );
}

type CodeEditorProps = Omit<React.ComponentProps<"div">, "onCopy"> & {
  children: string;
  lang: string;
  themes?: {
    light: string;
    dark: string;
  };
  duration?: number;
  delay?: number;
  header?: boolean;
  dots?: boolean;
  icon?: React.ReactNode;
  cursor?: boolean;
  inView?: boolean;
  inViewMargin?: UseInViewOptions["margin"];
  inViewOnce?: boolean;
  copyButton?: boolean;
  writing?: boolean;
  title?: string;
  onDone?: () => void;
  onCopy?: (content: string) => void;
};

function CodeEditor({
  children: code,
  lang,
  themes = {
    light: "vitesse-light",
    dark: "vitesse-dark",
  },
  duration = 5,
  delay = 0,
  className,
  header = true,
  dots = true,
  icon,
  cursor = false,
  inView = false,
  inViewMargin = "0px",
  inViewOnce = true,
  copyButton = false,
  writing = true,
  title,
  onDone,
  onCopy,
  ...props
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme();
  const editorRef = React.useRef<HTMLDivElement>(null);
  const [visibleCode, setVisibleCode] = React.useState("");
  const [highlightedCode, setHighlightedCode] = React.useState("");
  const [isDone, setIsDone] = React.useState(false);

  const inViewResult = useInView(editorRef, {
    once: inViewOnce,
    margin: inViewMargin,
  });

  const isInView = !inView || inViewResult;

  React.useEffect(() => {
    if (!visibleCode.length || !isInView) return;

    const loadHighlightedCode = async () => {
      try {
        const { codeToHtml } = await import("shiki");

        const highlighted = await codeToHtml(visibleCode, {
          lang,
          themes: {
            light: themes.light,
            dark: themes.dark,
          },
          defaultColor: resolvedTheme === "dark" ? "dark" : "light",
        });

        setHighlightedCode(highlighted);
      } catch (e) {
        console.error(`Language "${lang}" could not be loaded.`, e);
      }
    };

    loadHighlightedCode();
  }, [
    lang,
    themes,
    writing,
    isInView,
    duration,
    delay,
    visibleCode,
    resolvedTheme,
  ]);

  React.useEffect(() => {
    if (!writing) {
      setVisibleCode(code);
      onDone?.();
      return;
    }

    if (!code.length || !isInView) {
      return;
    }

    const characters = Array.from(code);
    let index = 0;
    const totalDuration = duration * 1000;
    const interval = totalDuration / characters.length;
    let intervalId: NodeJS.Timeout;

    const timeout = setTimeout(() => {
      intervalId = setInterval(() => {
        if (index < characters.length) {
          const currentIndex = index;
          const currentChar = characters[currentIndex];
          index += 1;
          setVisibleCode((prev) => prev + currentChar);
          editorRef.current?.scrollTo({
            top: editorRef.current?.scrollHeight,
            behavior: "smooth",
          });
        } else {
          clearInterval(intervalId);
          setIsDone(true);
          onDone?.();
        }
      }, interval);
    }, delay * 1000);

    return () => {
      clearTimeout(timeout);
      clearInterval(intervalId);
    };
  }, [code, duration, delay, isInView, writing, onDone]);

  return (
    <div
      data-slot="code-editor"
      className={cn(
        "relative bg-muted/50 w-full border border-border overflow-hidden flex flex-col rounded-lg",
        className,
      )}
      {...props}
    >
      {header ?
        <div className="bg-muted/50 border-b border-border/75 dark:border-border/50 relative flex flex-row items-center justify-between gap-y-2 h-10 px-4">
          {dots && (
            <div className="flex flex-row gap-x-2">
              <div className="size-2 rounded-full bg-red-500"></div>
              <div className="size-2 rounded-full bg-yellow-500"></div>
              <div className="size-2 rounded-full bg-green-500"></div>
            </div>
          )}
          {title && (
            <div
              className={cn(
                "flex flex-row items-center gap-2",
                dots &&
                  "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
              )}
            >
              {icon ?
                <div
                  className="flex items-center text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0"
                  dangerouslySetInnerHTML={
                    typeof icon === "string" ? { __html: icon } : undefined
                  }
                >
                  {typeof icon !== "string" ? icon : null}
                </div>
              : null}
              <figcaption className="flex items-center truncate text-muted-foreground text-[13px] leading-none mt-0">
                {title}
              </figcaption>
            </div>
          )}
          {copyButton ?
            <CopyButton
              content={code}
              size="sm"
              variant="ghost"
              className="-me-2 bg-transparent hover:bg-black/5 dark:hover:bg-white/10"
              onCopy={onCopy}
            />
          : null}
        </div>
      : copyButton && (
          <CopyButton
            content={code}
            size="sm"
            variant="ghost"
            className="absolute right-2 top-2 z-[2] backdrop-blur-md bg-transparent hover:bg-black/5 dark:hover:bg-white/10"
            onCopy={onCopy}
          />
        )
      }
      <div
        ref={editorRef}
        className="h-[calc(100%-2.75rem)] w-full text-sm p-4 font-mono relative overflow-auto flex-1 min-h-[200px] bg-muted/30"
      >
        <div
          className={cn(
            "[&>pre,_&_code]:!bg-transparent [&>pre,_&_code]:bg-transparent [&>pre,_&_code]:border-none [&_code]:!text-[13px]",
            "[&_.shiki]:!bg-transparent [&_.shiki]:[background:var(--shiki-bg)_!important]",
            cursor &&
              !isDone &&
              "[&_.line:last-of-type::after]:content-['|'] [&_.line:last-of-type::after]:animate-pulse [&_.line:last-of-type::after]:inline-block [&_.line:last-of-type::after]:w-[1ch] [&_.line:last-of-type::after]:-translate-px",
          )}
          style={{ whiteSpace: "pre" }}
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </div>
    </div>
  );
}

export { CodeEditor, CopyButton, type CodeEditorProps, type CopyButtonProps };
