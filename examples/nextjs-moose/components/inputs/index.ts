/**
 * Shared Input Components
 *
 * Reusable form inputs for reports, dashboards, and other UIs.
 *
 * ## Components
 *
 * - `DatePicker` - Single date input with calendar
 * - `DateRangeInput` - Start/end date range with optional presets
 * - `MultiSelectChips` - Multi-select using toggle chips
 * - `SelectDropdown` - Single-select dropdown
 *
 * ## Usage
 *
 * ```tsx
 * import {
 *   DateRangeInput,
 *   MultiSelectChips,
 *   SelectDropdown,
 * } from "@/components/inputs";
 *
 * // Date range with presets
 * <DateRangeInput
 *   startDate={start}
 *   endDate={end}
 *   onChange={({ start, end }) => setDateRange(start, end)}
 *   showPresets={true}
 * />
 *
 * // Multi-select chips for dimensions
 * <MultiSelectChips
 *   options={[
 *     { id: "status", label: "Status" },
 *     { id: "day", label: "Day" },
 *   ]}
 *   selected={selectedDims}
 *   onChange={setSelectedDims}
 *   variant="secondary"
 * />
 *
 * // Single-select dropdown
 * <SelectDropdown
 *   options={dimensions}
 *   value={groupBy}
 *   onChange={setGroupBy}
 *   label="Group By"
 * />
 * ```
 *
 * @module inputs
 */

// Components
export { DatePicker, type DatePickerProps } from "./date-picker";
export { DateRangeInput, type DateRangeInputProps } from "./date-range-input";
export {
  MultiSelectChips,
  type MultiSelectChipsProps,
} from "./multi-select-chips";
export { SelectDropdown, type SelectDropdownProps } from "./select-dropdown";

// Types and utilities
export {
  type DatePreset,
  type DateRange,
  type PresetOption,
  type FieldOption,
  getDateRangeForPreset,
  getDefaultDateRange,
  DEFAULT_DATE_PRESETS,
} from "./types";
