"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagInput } from "./tag-input";
import { Label } from "@/components/ui/label";

interface TrendingTopicsControlsProps {
  interval: string;
  limit: number;
  exclude: string;
  onIntervalChange: (value: string) => void;
  onLimitChange: (value: number) => void;
  onExcludeChange: (value: string) => void;
}

export function TrendingTopicsControls({
  interval,
  limit,
  exclude,
  onIntervalChange,
  onLimitChange,
  onExcludeChange,
}: TrendingTopicsControlsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-6 gap-4 p-4 bg-gray-50 rounded-lg">
      <div>
        <Label htmlFor="interval">Time Interval</Label>
        <Select value={interval} onValueChange={onIntervalChange}>
          <SelectTrigger id="interval">
            <SelectValue placeholder="Select interval" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="minute">Minute</SelectItem>
            <SelectItem value="hour">Hour</SelectItem>
            <SelectItem value="day">Day</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="limit">Number of Topics</Label>
        <Select
          value={(limit ?? 10).toString()}
          onValueChange={(value) => onLimitChange(parseInt(value))}
        >
          <SelectTrigger id="limit">
            <SelectValue placeholder="Select limit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="5">5</SelectItem>
            <SelectItem value="10">10</SelectItem>
            <SelectItem value="15">15</SelectItem>
            <SelectItem value="20">20</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="md:col-span-3">
        <Label htmlFor="exclude-tags" className="mb-2 block">
          Exclude Topics
        </Label>
        <TagInput
          tags={exclude ? exclude.split(",") : []}
          onTagsChange={(tags) => onExcludeChange(tags.join(",") || "")}
          placeholder="Type a topic to exclude and press Enter"
        />
      </div>
    </div>
  );
}
