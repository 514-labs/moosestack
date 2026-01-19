# Shared Input Components

Reusable form input components for reports, dashboards, and other UIs.

## Components

### DatePicker

Single date input with calendar popup.

```tsx
import { DatePicker } from "@/components/inputs";

<DatePicker
  value={date}
  onChange={setDate}
  label="Select Date"
  placeholder="Pick a date"
/>
```

**Props:**
- `value: string` - Date in YYYY-MM-DD format
- `onChange: (date: string) => void` - Called when date changes
- `label?: ReactNode` - Label above input
- `placeholder?: string` - Placeholder text
- `disabled?: boolean` - Disable input
- `className?: string` - Additional CSS classes

### DateRangeInput

Combined start/end date range with optional presets.

```tsx
import { DateRangeInput } from "@/components/inputs";

<DateRangeInput
  startDate={startDate}
  endDate={endDate}
  onChange={({ start, end }) => {
    setStartDate(start);
    setEndDate(end);
  }}
  showPresets={true}
  presetLabel="Range"
/>
```

**Props:**
- `startDate: string` - Start date (YYYY-MM-DD)
- `endDate: string` - End date (YYYY-MM-DD)
- `onChange: (range: DateRange) => void` - Called when range changes
- `showPresets?: boolean` - Show preset dropdown (default: true)
- `presets?: PresetOption[]` - Custom presets
- `presetLabel?: string` - Label for preset dropdown
- `startLabel?: ReactNode` - Label for start date
- `endLabel?: ReactNode` - Label for end date
- `showIcons?: boolean` - Show icons in labels (default: true)
- `inputWidth?: string` - Width class for inputs

### MultiSelectChips

Multi-select using toggle chips.

```tsx
import { MultiSelectChips } from "@/components/inputs";

const options = [
  { id: "status", label: "Status", description: "Event status" },
  { id: "day", label: "Day", description: "Day of week" },
];

<MultiSelectChips
  options={options}
  selected={selectedIds}
  onChange={setSelectedIds}
  variant="primary"
/>
```

**Props:**
- `options: FieldOption[]` - Available options
- `selected: string[]` - Currently selected IDs
- `onChange: (selected: string[]) => void` - Called when selection changes
- `variant?: "primary" | "secondary"` - Visual style
- `disabled?: boolean` - Disable all chips
- `minSelections?: number` - Minimum required selections
- `maxSelections?: number` - Maximum allowed selections

### SelectDropdown

Single-select dropdown.

```tsx
import { SelectDropdown } from "@/components/inputs";

const options = [
  { id: "status", label: "By Status" },
  { id: "day", label: "By Day" },
];

<SelectDropdown
  options={options}
  value={groupBy}
  onChange={setGroupBy}
  label="Group By"
/>
```

**Props:**
- `options: FieldOption[]` - Available options
- `value: string` - Currently selected ID
- `onChange: (value: string) => void` - Called when selection changes
- `label?: ReactNode` - Label above select
- `placeholder?: string` - Placeholder text
- `disabled?: boolean` - Disable select
- `width?: string` - Width class for trigger

### Chip

Individual toggle chip (used internally by MultiSelectChips).

```tsx
import { Chip } from "@/components/inputs";

<Chip
  label="Status"
  selected={isSelected}
  onClick={handleToggle}
  variant="primary"
/>
```

## Types

```ts
// Date preset options
type DatePreset = "24h" | "7d" | "30d" | "90d" | "custom";

// Date range
interface DateRange {
  start: string;  // YYYY-MM-DD
  end: string;    // YYYY-MM-DD
}

// Preset option
interface PresetOption<T extends string = string> {
  label: string;
  value: T;
}

// Field option for selects
interface FieldOption<TId extends string = string> {
  id: TId;
  label: string;
  description?: string;
}
```

## Utilities

```ts
import {
  getDateRangeForPreset,
  getDefaultDateRange,
  DEFAULT_DATE_PRESETS,
} from "@/components/inputs";

// Get date range for a preset
const range = getDateRangeForPreset("30d");
// → { start: "2024-01-01", end: "2024-01-31" }

// Get default range (30 days)
const defaultRange = getDefaultDateRange();

// Default presets array
DEFAULT_DATE_PRESETS
// → [{ label: "Last 24 hours", value: "24h" }, ...]
```

## Usage with Report Builder

The Report Builder uses these components internally:

```tsx
// In report-builder.tsx
import {
  DateRangeInput,
  MultiSelectChips,
  SelectDropdown,
} from "@/components/inputs";

// Dimensions selection
<MultiSelectChips
  options={dimensionOptions}
  selected={selectedDimensions}
  onChange={setSelectedDimensions}
  variant="secondary"
/>

// Metrics selection
<MultiSelectChips
  options={metricOptions}
  selected={selectedMetrics}
  onChange={setSelectedMetrics}
  variant="primary"
/>

// Group by dropdown
<SelectDropdown
  options={dimensionOptions}
  value={groupBy}
  onChange={setGroupBy}
  label="Group By"
/>

// Date range filter
<DateRangeInput
  startDate={startDate}
  endDate={endDate}
  onChange={handleDateChange}
  showPresets={true}
/>
```

## Usage with Dashboard

```tsx
// In filter-bar.tsx
import { DateRangeInput } from "@/components/inputs";
import { useDateFilter } from "@/lib/hooks";

export function FilterBar() {
  const { startDate, endDate, setStartDate, setEndDate } = useDateFilter();

  return (
    <DateRangeInput
      startDate={startDate}
      endDate={endDate}
      onChange={({ start, end }) => {
        setStartDate(start);
        setEndDate(end);
      }}
      showPresets={true}
    />
  );
}
```

## Customization

### Custom Date Presets

```tsx
const customPresets = [
  { label: "Today", value: "24h" },
  { label: "This Week", value: "7d" },
  { label: "This Month", value: "30d" },
  { label: "Custom Range", value: "custom" },
];

<DateRangeInput
  presets={customPresets}
  // ...
/>
```

### Styling

All components accept `className` props for additional styling:

```tsx
<DateRangeInput
  className="bg-muted p-4 rounded-lg"
  inputWidth="w-[200px]"
  // ...
/>
```
