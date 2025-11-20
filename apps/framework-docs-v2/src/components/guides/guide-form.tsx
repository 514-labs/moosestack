"use client";

import * as React from "react";
import { useForm } from "@tanstack/react-form";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { z } from "zod";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { GuideManifest } from "@/lib/guide-types";
import { useLanguage } from "@/hooks/use-language";

interface GuideFormProps {
  manifest: GuideManifest;
}

export function GuideForm({ manifest }: GuideFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { language } = useLanguage();

  // Create a dynamic schema based on the manifest options
  const schema = React.useMemo(() => {
    const shape: Record<string, z.ZodTypeAny> = {};
    manifest.options.forEach((option) => {
      shape[option.id] = z.string().min(1, "Selection is required");
    });
    return z.object(shape);
  }, [manifest]);

  // Initialize default values from URL search params, manifest defaults, or language preference
  const defaultValues = React.useMemo(() => {
    const values: Record<string, string> = {};
    manifest.options.forEach((option) => {
      const paramValue = searchParams.get(option.id);
      if (paramValue) {
        values[option.id] = paramValue;
      } else if (option.id === "lang") {
        // For language, use the global language preference (from localStorage or default to typescript)
        values[option.id] = language === "typescript" ? "ts" : "python";
      } else if (option.defaultValue) {
        values[option.id] = option.defaultValue;
      } else {
        // Default to first value if available, to ensure we have a valid state if possible
        if (option.values.length > 0) {
          values[option.id] = option.values[0].id;
        }
      }
    });
    return values;
  }, [manifest, searchParams, language]);

  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      // Validate before submitting
      const result = schema.safeParse(value);
      if (!result.success) {
        console.error("Form validation failed:", result.error);
        return;
      }
      // Update URL with new values, preserving lang param
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(value).forEach(([key, val]) => {
        if (val) {
          params.set(key, val as string);
        } else {
          params.delete(key);
        }
      });
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
  });

  // Update form when guide-related searchParams change
  React.useEffect(() => {
    const currentValues: Record<string, string> = {};
    let hasGuideParams = false;

    manifest.options.forEach((option) => {
      const paramValue = searchParams.get(option.id);
      if (paramValue) {
        currentValues[option.id] = paramValue;
        hasGuideParams = true;
      } else if (option.id === "lang") {
        // Sync language from global preference if not in URL
        currentValues[option.id] = language === "typescript" ? "ts" : "python";
        hasGuideParams = true;
      }
    });

    // Only update if we have guide params and they differ from form state
    if (hasGuideParams) {
      const needsUpdate = manifest.options.some((option) => {
        const currentValue = currentValues[option.id];
        const formValue = form.state.values[option.id] as string | undefined;
        return currentValue && currentValue !== formValue;
      });

      if (needsUpdate) {
        form.setFieldValues(currentValues);
      }
    }
  }, [searchParams, manifest, language]);

  return (
    <div className="space-y-6 p-6 border rounded-lg bg-card text-card-foreground shadow-sm mb-8">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Customize Your Guide</h3>
        <p className="text-sm text-muted-foreground">
          Select your stack preferences to get a tailored guide.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
      >
        {manifest.options.map((option) => (
          <form.Field
            key={option.id}
            name={option.id}
            children={(field) => {
              // Handle language option specially - sync with global language preference
              const handleLanguageChange = (value: string) => {
                field.handleChange(value);
                // Map guide form language values to URL lang param
                const langParam = value === "ts" ? "typescript" : "python";
                const params = new URLSearchParams(searchParams.toString());
                params.set("lang", langParam);
                // Preserve all other guide params
                manifest.options.forEach((opt) => {
                  if (opt.id !== option.id && form.state.values[opt.id]) {
                    params.set(opt.id, form.state.values[opt.id] as string);
                  }
                });
                router.push(`${pathname}?${params.toString()}`, {
                  scroll: false,
                });
              };

              const handleOtherChange = (value: string) => {
                field.handleChange(value);
                // Update URL directly without going through form submit to avoid loops
                const params = new URLSearchParams(searchParams.toString());
                params.set(option.id, value);
                // Preserve all other guide params (including lang)
                manifest.options.forEach((opt) => {
                  if (opt.id !== option.id && form.state.values[opt.id]) {
                    params.set(opt.id, form.state.values[opt.id] as string);
                  }
                });
                // Preserve lang param
                const langParam = searchParams.get("lang");
                if (langParam) {
                  params.set("lang", langParam);
                }
                router.push(`${pathname}?${params.toString()}`, {
                  scroll: false,
                });
              };

              return (
                <div className="space-y-2">
                  <Label htmlFor={option.id}>{option.label}</Label>
                  <Select
                    value={field.state.value || ""}
                    onValueChange={
                      option.id === "lang" ?
                        handleLanguageChange
                      : handleOtherChange
                    }
                  >
                    <SelectTrigger id={option.id}>
                      <SelectValue placeholder={`Select ${option.label}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {option.values.map((val) => (
                        <SelectItem key={val.id} value={val.id}>
                          {val.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(
                    field.state.meta.isTouched && field.state.meta.errors.length
                  ) ?
                    <p className="text-sm text-destructive">
                      {field.state.meta.errors.join(", ")}
                    </p>
                  : null}
                </div>
              );
            }}
          />
        ))}
      </form>
    </div>
  );
}
