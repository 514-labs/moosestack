export interface FieldOption {
  id: string;
  label: string;
  description?: string;
  dataKey?: string;
}

export interface FilterOption {
  id: string;
  label: string;
  operators: string[];
  description?: string;
  values?: { value: string; label: string }[];
}

export interface FilterValue {
  [operator: string]: unknown;
}

export interface ReportModel {
  metrics: FieldOption[];
  dimensions: FieldOption[];
  filters: FilterOption[];
}

export interface QueryRequest {
  dimensions: string[];
  metrics: string[];
  filters?: Record<string, Record<string, unknown>>;
  limit?: number;
}
