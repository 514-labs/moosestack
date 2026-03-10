export interface FieldOption {
  id: string;
  label: string;
  description?: string;
  dataKey?: string;
}

export interface FilterOption {
  id: string;
  label: string;
  description?: string;
  operators: string[];
  /** Known values for chip/dropdown selection. */
  values?: { value: string; label: string }[];
}

export interface FilterValue {
  [operator: string]: unknown;
}

export interface QueryRequest {
  dimensions: string[];
  metrics: string[];
  filters?: Record<string, FilterValue>;
  limit?: number;
}

export interface ReportModel {
  dimensions: FieldOption[];
  metrics: FieldOption[];
  filters: FilterOption[];
}
