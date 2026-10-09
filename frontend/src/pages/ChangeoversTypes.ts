/** Shared preview/plan types for the changeover planning flow. */

export interface Comparison {
  kind: string;
  key: string;
  label: string;
  category: string;
  current_value: unknown;
  target_value: unknown;
  unit: string;
  change_required: boolean;
  validation: { status: string; message: string };
}

export interface PlanStep {
  step_id: string;
  sequence_number: number;
  task_type: string;
  category: string;
  description: string;
  instructions: string;
  component: string | null;
  parameter: string | null;
  current_value: string | null;
  target_value: string | null;
  prerequisites: number[];
  safety_notes: string;
  verification_criteria: string;
  requires_confirmation: boolean;
  expected_duration_seconds: number;
  status: string;
}

export interface Preview {
  machine: { id: string; name: string; status: string };
  target_product: { id: string; name: string };
  comparison: Comparison[];
  differences: Comparison[];
  tasks: PlanStep[];
  change_count: number;
  no_change_required: boolean;
  estimated_duration_seconds: number;
  duration_estimate_note: string;
  eligibility: { eligible: boolean; errors: string[]; warnings: string[] };
}
