/**
 * In real projects, replace this file with generated Supabase types:
 *
 *   supabase gen types typescript --project-id "$PROJECT_REF" > app/connectors/supabase/supabase.generated.ts
 */

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string;
          name: string;
          hourly_rate: number;
          updated_at: string;
        };
      };
      time_entries: {
        Row: {
          id: string;
          project_id: string;
          worker_id: string;
          hours_worked: number;
          work_date: string;
          updated_at: string;
        };
      };
    };
  };
}

export type SupabaseTableName = keyof Database["public"]["Tables"];

export type SupabaseTableRow<TTable extends SupabaseTableName> =
  Database["public"]["Tables"][TTable]["Row"];
