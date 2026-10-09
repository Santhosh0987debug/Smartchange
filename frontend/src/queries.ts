import { QueryClient, useQuery } from '@tanstack/react-query';
import { API } from './api';

export const MACHINE_ID = 'FILL-01';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export interface ListParams {
  q?: string;
  status?: string;
  line?: string;
  category?: string;
  active?: boolean;
  page?: number;
  page_size?: number;
}

function clean(params: ListParams): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

export const keys = {
  health: ['health'],
  users: ['users'],
  machines: (params: ListParams) => ['machines', params],
  machine: (id: string) => ['machine', id],
  machineState: (id: string) => ['machine-state', id],
  products: (params: ListParams) => ['products', params],
  product: (id: string) => ['product', id],
  changeovers: (params: ListParams) => ['changeovers', params],
  session: (id: number) => ['session', id],
  summary: ['summary'],
  history: ['history'],
  docs: ['docs'],
} as const;

export function useHealth() {
  return useQuery({ queryKey: keys.health, queryFn: API.health });
}
export function useUsers() {
  return useQuery({ queryKey: keys.users, queryFn: API.users });
}
export function useMachines(params: ListParams = {}) {
  return useQuery({ queryKey: keys.machines(params), queryFn: () => API.machines(clean(params)) });
}
export function useMachine(id: string | null) {
  return useQuery({
    queryKey: keys.machine(id ?? ''),
    queryFn: () => API.machine(id ?? ''),
    enabled: !!id,
  });
}
export function useMachineState(id: string = MACHINE_ID) {
  return useQuery({ queryKey: keys.machineState(id), queryFn: () => API.machineState(id) });
}
export function useProducts(params: ListParams = {}) {
  return useQuery({ queryKey: keys.products(params), queryFn: () => API.products(clean(params)) });
}
export function useProduct(id: string | null) {
  return useQuery({
    queryKey: keys.product(id ?? ''),
    queryFn: () => API.product(id ?? ''),
    enabled: !!id,
  });
}
export function useChangeovers(params: ListParams = {}) {
  return useQuery({ queryKey: keys.changeovers(params), queryFn: () => API.changeovers(clean(params)) });
}
export function useSession(id: number | null) {
  return useQuery({
    queryKey: keys.session(id ?? 0),
    queryFn: () => API.session(id ?? 0),
    enabled: id != null,
  });
}
export function useSimulation(id: number | null) {
  return useQuery({
    queryKey: ['simulation', id ?? 0],
    queryFn: () => API.simulation(id ?? 0),
    enabled: id != null,
  });
}
export function useVerification(id: number | null) {
  return useQuery({
    queryKey: ['verification', id ?? 0],
    queryFn: () => API.verification(id ?? 0),
    enabled: id != null,
  });
}
export function useSummary() {
  return useQuery({ queryKey: keys.summary, queryFn: API.summary });
}
export function useHistory(params: ListParams = {}) {
  return useQuery({ queryKey: ['history', params], queryFn: () => API.history(clean(params)) });
}
export function useOverview(params: Record<string, string | undefined> = {}) {
  return useQuery({ queryKey: ['overview', params], queryFn: () => API.overview(clean(params)) });
}
export function useOverTime(params: Record<string, string | undefined> = {}) {
  return useQuery({ queryKey: ['over-time', params], queryFn: () => API.overTime(clean(params)) });
}
export function useMachinePerf(params: Record<string, string | undefined> = {}) {
  return useQuery({ queryKey: ['machine-perf', params], queryFn: () => API.machinePerformance(clean(params)) });
}
export function useVerificationStats(params: Record<string, string | undefined> = {}) {
  return useQuery({ queryKey: ['verification-stats', params], queryFn: () => API.verificationStats(clean(params)) });
}
export function useCommonChanges(params: Record<string, string | undefined> = {}) {
  return useQuery({ queryKey: ['common-changes', params], queryFn: () => API.commonChanges(clean(params)) });
}
export function useIssuesStats(params: Record<string, string | undefined> = {}) {
  return useQuery({ queryKey: ['issues-stats', params], queryFn: () => API.issuesStats(clean(params)) });
}
export function useDurationComparison(params: Record<string, string | undefined> = {}) {
  return useQuery({ queryKey: ['duration-comparison', params], queryFn: () => API.durationComparison(clean(params)) });
}
export function useDocs(params: ListParams = {}) {
  return useQuery({ queryKey: ['docs', params], queryFn: () => API.docs(clean(params)) });
}
export function useDocument(id: number | null) {
  return useQuery({
    queryKey: ['document', id ?? 0],
    queryFn: () => API.document(id ?? 0),
    enabled: id != null,
  });
}
export function useAiStatus() {
  return useQuery({ queryKey: ['ai-status'], queryFn: API.aiStatus });
}

/** Refresh the cross-page overview data (machines, live state, analytics). */
export function invalidateOverview() {
  return queryClient.invalidateQueries();
}
