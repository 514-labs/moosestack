import React from "react";
import { useLanguage } from "./LanguageContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Heading, HeadingLevel } from "@/components/typography";

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="sticky top-[64px] z-10 bg-background flex items-center justify-start gap-2 transition-[border] duration-200 [@supports(overflow-clip:unset)]:border-0 [@scroll(0)]:border-b-0 border-b">
      <Heading level={HeadingLevel.l5} className="text-captialize text-primary">
        Viewing:
      </Heading>
      <Select
        value={language}
        onValueChange={(value: "typescript" | "python") => setLanguage(value)}
      >
        <SelectTrigger className="w-[auto] py-4 text-md flex items-center gap-2">
          <SelectValue placeholder="Select Language" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="typescript">TypeScript</SelectItem>
          <SelectItem value="python">Python</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
