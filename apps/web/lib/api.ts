// Typed client for the Kunatra API (apps/api). All money is in rupees across this boundary.
import type { Assessment } from "@atlas/engine";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4100";

export type AssetClass =
  | "real_estate" | "mutual_fund" | "sip" | "equity" | "epf" | "ppf"
  | "nps" | "fd" | "rd" | "bonds" | "cash" | "gold" | "insurance" | "other";

export interface Valuation {
  id: string;
  assetId: string;
  value: number;
  asOf: string;
  source: string | null;
}

export interface Contribution {
  id: string;
  assetId: string;
  amount: number;
  on: string;
  note: string | null;
}

export interface RealEstate {
  address?: string | null;
  sqft?: number | null;
  undividedShare?: string | null;
  ptin?: string | null;
  carPark?: string | null;
  carParkSize?: string | null;
}

export interface Asset {
  id: string;
  householdId: string;
  name: string;
  assetClass: AssetClass;
  value: number;
  liquid: boolean;
  parentAssetId: string | null;
  costBasis: number | null;
  monthlyContribution: number | null;
  realEstate: RealEstate | null;
}

export interface Loan {
  id: string;
  householdId: string;
  name: string;
  outstanding: number;
  emiMonthly: number;
  ratePct: number | null;
  securedAssetId: string | null;
}

export interface Household {
  id: string;
  displayName: string;
  monthlyTakeHome: number | null;
  monthlyEssential: number | null;
  createdAt: string;
}

// ---- asset operations -----------------------------------------------------

export type WorkOrderStatus = "open" | "in_progress" | "done" | "cancelled";
export type WorkOrderCategory = "repair" | "maintenance" | "amc" | "improvement" | "other";
export type InspectionRating = "good" | "fair" | "poor";

export interface Vendor {
  id: string;
  householdId: string;
  name: string;
  category: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
}

export interface WorkOrder {
  id: string;
  householdId: string;
  assetId: string | null;
  vendorId: string | null;
  assetName: string | null;
  vendorName: string | null;
  title: string;
  category: WorkOrderCategory;
  status: WorkOrderStatus;
  scheduledFor: string | null;
  estimatedCost: number | null;
  actualCost: number | null;
  notes: string | null;
  closureNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Inspection {
  id: string;
  householdId: string;
  assetId: string | null;
  assetName: string | null;
  inspectedOn: string;
  rating: InspectionRating;
  notes: string | null;
  createdAt: string;
}

export interface OperationsSummary {
  workOrders: { open: number; inProgress: number; done: number; cancelled: number; active: number };
  maintenanceSpendYtd: number;
  vendors: number;
  lastInspection: { rating: InspectionRating; on: string } | null;
}

export type Role = "owner" | "operations";

export interface User {
  id: string;
  householdId: string;
  email: string;
  fullName: string | null;
  role: Role;
  createdAt?: string;
}

export interface Session { token: string; user: User; }

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (res.status === 401 && typeof window !== "undefined") {
    // Session gone/expired — drop it and send the user to sign in.
    clearSession();
    if (!window.location.pathname.startsWith("/login")) window.location.href = "/login";
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "error", body.message ?? body.error ?? "Request failed");
  }
  return body as T;
}

export const api = {
  // auth
  register: (b: { email: string; password: string; fullName?: string; householdName?: string; monthlyTakeHome?: number; monthlyEssential?: number }) =>
    req<Session>("/api/auth/register", { method: "POST", body: JSON.stringify(b) }),
  login: (b: { email: string; password: string }) =>
    req<Session>("/api/auth/login", { method: "POST", body: JSON.stringify(b) }),
  me: () => req<User>("/api/auth/me"),

  // team (owner only)
  listUsers: (id: string) => req<User[]>(`/api/households/${id}/users`),
  createUser: (id: string, b: { email: string; password: string; fullName?: string; role: Role }) =>
    req<User>(`/api/households/${id}/users`, { method: "POST", body: JSON.stringify(b) }),
  deleteUser: (userId: string) => req<void>(`/api/users/${userId}`, { method: "DELETE" }),

  // households
  getHousehold: (id: string) => req<Household>(`/api/households/${id}`),
  updateHousehold: (id: string, b: Partial<{ displayName: string; monthlyTakeHome: number | null; monthlyEssential: number | null }>) =>
    req<Household>(`/api/households/${id}`, { method: "PATCH", body: JSON.stringify(b) }),

  // assessment (engine output)
  assessment: (id: string) => req<Assessment>(`/api/households/${id}/assessment`),

  // assets
  listAssets: (id: string) => req<Asset[]>(`/api/households/${id}/assets`),
  createAsset: (id: string, b: Partial<Asset>) =>
    req<Asset>(`/api/households/${id}/assets`, { method: "POST", body: JSON.stringify(b) }),
  updateAsset: (assetId: string, b: Partial<Asset>) =>
    req<Asset>(`/api/assets/${assetId}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteAsset: (assetId: string) => req<void>(`/api/assets/${assetId}`, { method: "DELETE" }),

  // valuations (appreciation history)
  listValuations: (assetId: string) => req<Valuation[]>(`/api/assets/${assetId}/valuations`),
  addValuation: (assetId: string, b: { value: number; asOf: string; source?: string }) =>
    req<Valuation>(`/api/assets/${assetId}/valuations`, { method: "POST", body: JSON.stringify(b) }),
  deleteValuation: (valuationId: string) => req<void>(`/api/valuations/${valuationId}`, { method: "DELETE" }),

  // contributions ledger (drives XIRR)
  listContributions: (assetId: string) => req<Contribution[]>(`/api/assets/${assetId}/contributions`),
  addContribution: (assetId: string, b: { amount: number; on: string; note?: string }) =>
    req<Contribution>(`/api/assets/${assetId}/contributions`, { method: "POST", body: JSON.stringify(b) }),
  addSipSchedule: (assetId: string, b: { amount: number; startOn: string; until?: string }) =>
    req<{ added: number }>(`/api/assets/${assetId}/contributions/schedule`, { method: "POST", body: JSON.stringify(b) }),
  deleteContribution: (id: string) => req<void>(`/api/contributions/${id}`, { method: "DELETE" }),

  // loans
  listLoans: (id: string) => req<Loan[]>(`/api/households/${id}/loans`),
  createLoan: (id: string, b: Partial<Loan>) =>
    req<Loan>(`/api/households/${id}/loans`, { method: "POST", body: JSON.stringify(b) }),
  updateLoan: (loanId: string, b: Partial<Loan>) =>
    req<Loan>(`/api/loans/${loanId}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteLoan: (loanId: string) => req<void>(`/api/loans/${loanId}`, { method: "DELETE" }),

  // operations: vendors
  listVendors: (id: string) => req<Vendor[]>(`/api/households/${id}/vendors`),
  createVendor: (id: string, b: Partial<Vendor>) =>
    req<Vendor>(`/api/households/${id}/vendors`, { method: "POST", body: JSON.stringify(b) }),
  updateVendor: (vendorId: string, b: Partial<Vendor>) =>
    req<Vendor>(`/api/vendors/${vendorId}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteVendor: (vendorId: string) => req<void>(`/api/vendors/${vendorId}`, { method: "DELETE" }),

  // operations: work orders
  listWorkOrders: (id: string) => req<WorkOrder[]>(`/api/households/${id}/work-orders`),
  createWorkOrder: (id: string, b: Partial<WorkOrder>) =>
    req<WorkOrder>(`/api/households/${id}/work-orders`, { method: "POST", body: JSON.stringify(b) }),
  updateWorkOrder: (woId: string, b: Partial<WorkOrder> & { status?: WorkOrderStatus }) =>
    req<WorkOrder>(`/api/work-orders/${woId}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteWorkOrder: (woId: string) => req<void>(`/api/work-orders/${woId}`, { method: "DELETE" }),

  // operations: inspections + summary
  listInspections: (id: string) => req<Inspection[]>(`/api/households/${id}/inspections`),
  createInspection: (id: string, b: Partial<Inspection>) =>
    req<Inspection>(`/api/households/${id}/inspections`, { method: "POST", body: JSON.stringify(b) }),
  deleteInspection: (inspId: string) => req<void>(`/api/inspections/${inspId}`, { method: "DELETE" }),
  operationsSummary: (id: string) => req<OperationsSummary>(`/api/households/${id}/operations/summary`),
};

// --- session, persisted in the browser ---
const TOKEN_KEY = "kunatra.token";
const USER_KEY = "kunatra.user";

export const getToken = () =>
  typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);

export const getUser = (): User | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as User) : null;
};

export const saveSession = (s: Session) => {
  window.localStorage.setItem(TOKEN_KEY, s.token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(s.user));
};

export const clearSession = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
};

/** The current user's household id (from the stored session). */
export const currentHousehold = () => getUser()?.householdId ?? null;
