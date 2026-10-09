import axios, { AxiosError } from 'axios';

/** Centralized API configuration. Same-origin by default (Vite dev proxies
 *  /api to the backend); override with VITE_API_BASE_URL for other setups.
 *
 *  Every endpoint path in this client already starts with `/api`, so the base
 *  must be the backend *origin* (e.g. `https://smartchange.onrender.com`) —
 *  never include an `/api` suffix, or requests become `/api/api/...` (404).
 *  Trailing slashes and a trailing `/api` are stripped defensively so a
 *  dashboard misconfiguration degrades into a working URL instead of 404s. */
function normalizeBase(raw: string | undefined): string {
  const base = (raw ?? '').trim().replace(/\/+$/, '');
  if (/\/api$/i.test(base)) return base.slice(0, -'/api'.length);
  return base;
}

export const API_BASE_URL: string = normalizeBase(import.meta.env.VITE_API_BASE_URL);

export const api = axios.create({ baseURL: API_BASE_URL });

/** Normalize any thrown value into a human-readable message. */
export function getApiError(e: unknown): string {
  if (e instanceof AxiosError) {
    const detail = e.response?.data?.detail ?? e.response?.data?.message;
    if (typeof detail === 'string') return detail;
    if (detail != null) {
      try {
        return JSON.stringify(detail);
      } catch {
        /* fall through */
      }
    }
    if (e.code === 'ERR_NETWORK' || !e.response) {
      return `Backend unreachable at ${API_BASE_URL || 'same origin'}/api — is the FastAPI server running?`;
    }
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export interface User {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface Machine {
  id: string;
  name: string;
  machine_type?: string | null;
  line?: string | null;
  location?: string | null;
  status: string;
  current_product_id?: string | null;
  configuration_version: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface MachineDetail extends Machine {
  latest_state: {
    product_id: string | null;
    components: Record<string, unknown>;
    parameters: Record<string, unknown>;
    verification_status: string;
    recorded_at: string;
  } | null;
}

export interface MachineInput {
  id: string;
  name: string;
  machine_type?: string;
  line?: string;
  location?: string;
  status?: string;
  current_product_id?: string;
}

export interface Product {
  id: string;
  product_code: string;
  name: string;
  description?: string | null;
  configuration: {
    components: Record<string, unknown>;
    parameters: Record<string, unknown>;
    ranges?: Record<string, [number, number]>;
    units?: Record<string, string>;
  };
  revision: string;
  active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ProductInput {
  id: string;
  product_code: string;
  name: string;
  description?: string;
  configuration: Record<string, unknown>;
  revision?: string;
  active?: boolean;
}

export interface Issue {
  id: number;
  task_id: number | null;
  category: string;
  severity: string;
  description: string;
  resolution_status: string;
  created_at: string;
}

export interface AuditEntry {
  entity: string;
  entity_id: string;
  action: string;
  actor: string;
  at: string;
  details: Record<string, unknown>;
}

export interface StepNote {
  task_id: number | null;
  note: string;
  operator: string;
  at: string;
}

export interface Progress {
  total: number;
  completed: number;
  in_progress: number;
  failed: number;
  pending: number;
  percent: number;
  estimated_remaining_seconds: number;
}

export interface ChangeoverSummary {
  id: number;
  machine_id: string;
  source_product_id: string;
  target_product_id: string;
  status: string;
  operator_id: string;
  started_at: string;
  completed_at: string | null;
  tasks_total: number;
  tasks_completed: number;
}

export interface Simulation {
  changeover_id: number;
  machine_id: string;
  initial: { components: Record<string, unknown>; parameters: Record<string, unknown> };
  target: { components: Record<string, unknown>; parameters: Record<string, unknown> };
  simulated: { components: Record<string, unknown>; parameters: Record<string, unknown> };
  simulated_status: string;
  simulated_at: string | null;
  official: { components: Record<string, unknown>; parameters: Record<string, unknown>; product_id: string | null } | null;
  note: string;
}

export interface VerifyCheck {
  id: number;
  check_name: string;
  expected_value: string;
  actual_value: string;
  result: string;
  reason: string | null;
  at: string;
}

export interface VerifyData {
  changeover_id: number;
  overall: string;
  runs: { run: number; at: string; passed: boolean; checks: VerifyCheck[] }[];
}

export interface DocItem {
  id: number;
  title: string;
  description?: string | null;
  category?: string | null;
  revision: string;
  approval_status: string;
  effective_date: string;
  filename?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  processing_status: string;
  preview: string;
  content_length: number;
  uploaded_at?: string | null;
}

export interface AiSource {
  doc_id: number;
  title: string;
  revision: string;
  section: string;
}

export interface AiAnswer {
  answer: string;
  sources: AiSource[];
  excerpts: string[];
  provider: { name: string; configured: boolean };
  limitations: string[];
  warnings: string[];
  live_data: Record<string, unknown> | null;
  grounded: boolean;
}

export interface HistoryRow {
  id: number;
  machine_id: string;
  source: string;
  target: string;
  status: string;
  operator: string;
  simulated: boolean;
  started_at: string;
  completed_at: string | null;
  actual_duration_seconds: number | null;
  baseline_duration_seconds: number;
  changes: number;
  verification: string;
  issues_open: number;
}

export interface AnalyticsFilters {
  machine_id?: string;
  product_id?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  q?: string;
  sort?: string;
  page?: number;
  page_size?: number;
}

/** Download URL for CSV reports (same filters as the displayed data). */
export function reportUrl(path: '/api/reports/changeovers' | '/api/reports/summary', filters: AnalyticsFilters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return `${API_BASE_URL}${path}${qs ? `?${qs}` : ''}`;
}

export const API = {
  health: () => api.get('/api/health').then((r) => r.data),
  users: (): Promise<User[]> => api.get('/api/users').then((r) => r.data),
  machines: (params?: Record<string, string | number | boolean | undefined>): Promise<Paged<Machine>> =>
    api.get('/api/machines', { params }).then((r) => r.data),
  machine: (id: string): Promise<MachineDetail> =>
    api.get(`/api/machines/${id}`).then((r) => r.data),
  createMachine: (input: MachineInput) => api.post('/api/machines', input).then((r) => r.data),
  updateMachine: (id: string, input: Partial<MachineInput>) =>
    api.put(`/api/machines/${id}`, input).then((r) => r.data),
  deleteMachine: (id: string) => api.delete(`/api/machines/${id}`).then((r) => r.data),
  machineState: (id: string) => api.get(`/api/machines/${id}/state`).then((r) => r.data),
  products: (params?: Record<string, string | number | boolean | undefined>): Promise<Paged<Product>> =>
    api.get('/api/products', { params }).then((r) => r.data),
  product: (id: string): Promise<Product> => api.get(`/api/products/${id}`).then((r) => r.data),
  createProduct: (input: ProductInput) => api.post('/api/products', input).then((r) => r.data),
  updateProduct: (id: string, input: Partial<ProductInput>) =>
    api.put(`/api/products/${id}`, input).then((r) => r.data),
  deleteProduct: (id: string) => api.delete(`/api/products/${id}`).then((r) => r.data),
  preview: (machine_id: string, target_product_id: string, operator_id = 'demo-operator') =>
    api.post('/api/changeovers/preview', { machine_id, target_product_id, operator_id }).then((r) => r.data),
  create: (machine_id: string, target_product_id: string, operator_id = 'demo-operator') =>
    api.post('/api/changeovers', { machine_id, target_product_id, operator_id }).then((r) => r.data),
  session: (id: number) => api.get(`/api/changeovers/${id}`).then((r) => r.data),
  changeovers: (params?: Record<string, string | number | boolean | undefined>): Promise<Paged<ChangeoverSummary>> =>
    api.get('/api/changeovers', { params }).then((r) => r.data),
  stepStart: (cid: number, ref: string | number, operator_id = 'demo-operator') =>
    api.post(`/api/changeovers/${cid}/steps/${ref}/start`, { operator_id }).then((r) => r.data),
  stepComplete: (cid: number, ref: string | number, operator_id = 'demo-operator', note?: string) =>
    api.post(`/api/changeovers/${cid}/steps/${ref}/complete`, { operator_id, note }).then((r) => r.data),
  stepFail: (cid: number, ref: string | number, reason: string, operator_id = 'demo-operator') =>
    api.post(`/api/changeovers/${cid}/steps/${ref}/fail`, { reason, operator_id }).then((r) => r.data),
  stepNote: (cid: number, ref: string | number, note: string, operator_id = 'demo-operator') =>
    api.post(`/api/changeovers/${cid}/steps/${ref}/notes`, { note, operator_id }).then((r) => r.data),
  setTaskStatus: (cid: number, tid: number, status: string, operator_id = 'demo-operator') =>
    api.patch(`/api/changeovers/${cid}/tasks/${tid}`, { status, operator_id }).then((r) => r.data),
  completeTask: (cid: number, tid: number, operator_id = 'demo-operator') =>
    api.patch(`/api/changeovers/${cid}/tasks/${tid}`, { status: 'COMPLETED', operator_id }).then((r) => r.data),
  applyConfig: (cid: number, parameters: Record<string, number>, operator_id = 'demo-operator') =>
    api.post(`/api/changeovers/${cid}/apply-configuration`, { parameters, operator_id }).then((r) => r.data),
  verify: (cid: number) => api.post(`/api/changeovers/${cid}/verify`).then((r) => r.data),
  verification: (cid: number): Promise<VerifyData> =>
    api.get(`/api/changeovers/${cid}/verification`).then((r) => r.data),
  simulation: (cid: number): Promise<Simulation> =>
    api.get(`/api/changeovers/${cid}/simulation`).then((r) => r.data),
  complete: (cid: number, operator_id = 'demo-operator') =>
    api.post(`/api/changeovers/${cid}/complete`, { operator_id }).then((r) => r.data),
  abandon: (cid: number) => api.post(`/api/changeovers/${cid}/abandon`).then((r) => r.data),
  reportIssue: (cid: number, description: string, task_id?: number, category = 'general', severity = 'minor', operator_id = 'demo-operator') =>
    api.post(`/api/changeovers/${cid}/issues`, { description, task_id, category, severity, operator_id }).then((r) => r.data),
  resolveIssue: (iid: number, operator_id = 'demo-operator') =>
    api.patch(`/api/issues/${iid}/resolve`, { operator_id }).then((r) => r.data),
  summary: () => api.get('/api/analytics/summary').then((r) => r.data),
  overview: (params?: AnalyticsFilters) => api.get('/api/analytics/overview', { params }).then((r) => r.data),
  overTime: (params?: AnalyticsFilters) => api.get('/api/analytics/changeovers-over-time', { params }).then((r) => r.data),
  machinePerformance: (params?: AnalyticsFilters) => api.get('/api/analytics/machine-performance', { params }).then((r) => r.data),
  verificationStats: (params?: AnalyticsFilters) => api.get('/api/analytics/verification', { params }).then((r) => r.data),
  commonChanges: (params?: AnalyticsFilters) => api.get('/api/analytics/common-changes', { params }).then((r) => r.data),
  issuesStats: (params?: AnalyticsFilters) => api.get('/api/analytics/issues', { params }).then((r) => r.data),
  durationComparison: (params?: AnalyticsFilters) => api.get('/api/analytics/duration-comparison', { params }).then((r) => r.data),
  history: (params?: AnalyticsFilters): Promise<Paged<HistoryRow>> =>
    api.get('/api/analytics/changeovers', { params }).then((r) => r.data),
  ask: (question: string) => api.post('/api/assistant/query', { question }).then((r) => r.data),
  aiAsk: (question: string, opts?: { machine_id?: string; target_product_id?: string; changeover_id?: number }): Promise<AiAnswer> =>
    api.post('/api/ai/ask', { question, ...opts }).then((r) => r.data),
  aiStatus: () => api.get('/api/ai/status').then((r) => r.data),
  docs: (params?: Record<string, string | number | boolean | undefined>): Promise<Paged<DocItem>> =>
    api.get('/api/documents', { params }).then((r) => r.data),
  document: (id: number): Promise<DocItem> => api.get(`/api/documents/${id}`).then((r) => r.data),
  documentContent: (id: number): Promise<{ id: number; title: string; revision: string; approval_status: string; content: string }> =>
    api.get(`/api/documents/${id}/content`).then((r) => r.data),
  uploadDocument: (form: FormData) =>
    api.post('/api/documents/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  approveDocument: (id: number, operator_id = 'demo-operator') =>
    api.post(`/api/documents/${id}/approve`, { operator_id }).then((r) => r.data),
  archiveDocument: (id: number, operator_id = 'demo-operator') =>
    api.post(`/api/documents/${id}/archive`, { operator_id }).then((r) => r.data),
};
