"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";

function formatDateForInput(dateString: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "";

  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function stringToDate(dateString: string): Date | undefined {
  if (!dateString) return undefined;
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? undefined : date;
}

function dateToString(date: Date | undefined): string {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface DatePickerInputProps {
  id: string;
  label?: string;
  value: string; // YYYY-MM-DD format
  onChange: (date: string) => void;
  placeholder?: string;
  className?: string;
}

export function DatePickerInput({
  id,
  label,
  value,
  onChange,
  placeholder = "Select date",
  className,
}: DatePickerInputProps) {
  const [open, setOpen] = React.useState(false);
  const date = stringToDate(value);
  const [month, setMonth] = React.useState<Date | undefined>(
    date || new Date(),
  );
  const [inputValue, setInputValue] = React.useState(formatDateForInput(value));

  // Sync input value when value prop changes externally
  React.useEffect(() => {
    setInputValue(formatDateForInput(value));
    if (value) {
      const newDate = stringToDate(value);
      if (newDate) {
        setMonth(newDate);
      }
    }
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputVal = e.target.value;
    setInputValue(inputVal);

    // Try to parse the input as a date
    const parsedDate = new Date(inputVal);
    if (!isNaN(parsedDate.getTime())) {
      const dateStr = dateToString(parsedDate);
      onChange(dateStr);
      setMonth(parsedDate);
    }
  };

  const handleCalendarSelect = (selectedDate: Date | undefined) => {
    if (selectedDate) {
      const dateStr = dateToString(selectedDate);
      onChange(dateStr);
      setInputValue(formatDateForInput(dateStr));
      setMonth(selectedDate);
      setOpen(false);
    }
  };

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={id}
          className="text-muted-foreground text-sm mb-1 block"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <Input
          id={id}
          value={inputValue}
          placeholder={placeholder}
          className="bg-background pr-10"
          onChange={handleInputChange}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
            }
          }}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="absolute top-1/2 right-2 size-6 -translate-y-1/2"
            >
              <CalendarIcon className="size-3.5" />
              <span className="sr-only">Select date</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto overflow-hidden p-0"
            align="end"
            alignOffset={-8}
            sideOffset={10}
          >
            <Calendar
              mode="single"
              selected={date}
              captionLayout="dropdown"
              month={month}
              onMonthChange={setMonth}
              onSelect={handleCalendarSelect}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
