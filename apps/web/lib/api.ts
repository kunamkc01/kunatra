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

export interface AssetPhoto {
  id: string;
  assetId: string;
  dataUrl: string;
  caption: string | null;
  createdAt?: string;
}

export interface RealEstate {
  address?: string | null;
  sqft?: number | null;
  undividedShare?: string | null;
  ptin?: string | null;
  carPark?: string | null;
  carParkSize?: string | null;
}

export interface Member {
  id: string;
  householdId: string;
  name: string;
  monthlyGross: number | null;
  monthlyTds: number | null;
  monthlyNet: number | null;
  createdAt?: string;
}

export interface MemberAssessment {
  id: string;
  name: string;
  monthlyIncome: number | null; // net take-home
  assessment: Assessment;
}

export interface Asset {
  id: string;
  householdId: string;
  name: string;
  assetClass: AssetClass;
  value: number;
  liquid: boolean;
  parentAssetId: string | null;
  memberId: string | null;
  costBasis: number | null;
  monthlyContribution: number | null;
  monthlyRent: number | null;
  rentTds: number | null;
  acquiredHow: string | null;
  acquiredYear: number | null;
  realEstate: RealEstate | null;
}

export interface AssetMetrics {
  currentValue: number;
  costBasis: number | null;
  unrealizedGain: number;
  gainPct: number | null;
  xirrPct: number | null;
  monthlyContribution: number;
  netRentMonthly: number;
  dscr: number | null;
  emiToIncomePct: number | null;
  securedOutstanding: number;
  equity: number;
  ltvPct: number | null;
  appreciationCagrPct: number | null;
  acquiredYear: number | null;
}

export interface AssetDetail {
  ownerName: string | null;
  metrics: AssetMetrics;
  securedLoans: { id: string; name: string; outstanding: number; emiMonthly: number; ratePct: number | null }[];
  children: { id: string; name: string; assetClass: AssetClass; value: number }[];
}

export type ComplianceKind = "property_tax" | "insurance" | "amc" | "inspection" | "renewal" | "other";
export type Recurrence = "none" | "monthly" | "quarterly" | "yearly";

export interface ComplianceItem {
  id: string;
  householdId: string;
  assetId: string | null;
  assetName: string | null;
  title: string;
  kind: ComplianceKind;
  dueOn: string;
  recurrence: Recurrence;
  note: string | null;
}

export interface ComplianceSummary {
  overdue: number;
  dueSoon: number;
  total: number;
  next: { title: string; dueOn: string } | null;
}

export interface AuditEntry {
  id: string;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  label: string | null;
  createdAt: string;
}

export interface Loan {
  id: string;
  householdId: string;
  name: string;
  outstanding: number;
  emiMonthly: number;
  ratePct: number | null;
  securedAssetId: string | null;
  memberId: string | null;
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
  recurrence: Recurrence;
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
  recurrence: Recurrence;
  notes: string | null;
  createdAt: string;
}

export interface OperationsSummary {
  workOrders: { open: number; inProgress: number; done: number; cancelled: number; active: number };
  maintenanceSpendYtd: number;
  vendors: number;
  lastInspection: { rating: InspectionRating; on: string } | null;
}

export type Role = "owner" | "manager" | "member" | "operations" | "advisor";

export interface Membership {
  householdId: string;
  householdName: string;
  role: Role;
  memberId: string | null;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";
export interface Approval {
  id: string;
  householdId: string;
  requestedBy: string | null;
  title: string;
  amount: number | null;
  note: string | null;
  status: ApprovalStatus;
  decidedBy: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface User {
  id: string;
  householdId: string;
  email: string;
  fullName: string | null;
  role: Role;
  avatar?: string | null;
  phone?: string | null;
  memberId?: string | null;
  households?: Membership[];
  // present on team listings (a user's access within one household)
  memberName?: string | null;
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
  switchHousehold: (householdId: string) =>
    req<Session>("/api/auth/switch", { method: "POST", body: JSON.stringify({ householdId }) }),
  updateProfile: (b: { fullName?: string; avatar?: string | null; phone?: string | null }) =>
    req<User>("/api/auth/profile", { method: "PATCH", body: JSON.stringify(b) }),
  changePassword: (b: { currentPassword: string; newPassword: string }) =>
    req<{ ok: boolean }>("/api/auth/password", { method: "POST", body: JSON.stringify(b) }),
  resetTeammatePassword: (userId: string, newPassword: string) =>
    req<{ ok: boolean }>(`/api/users/${userId}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword }) }),
  forgotPassword: (email: string) =>
    req<{ ok: boolean }>("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, newPassword: string) =>
    req<{ ok: boolean }>("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, newPassword }) }),

  // team (owner only)
  listUsers: (id: string) => req<User[]>(`/api/households/${id}/users`),
  createUser: (id: string, b: { email: string; password?: string; fullName?: string; role: Role; memberId?: string | null }) =>
    req<{ ok: boolean; userId: string }>(`/api/households/${id}/users`, { method: "POST", body: JSON.stringify(b) }),
  deleteUser: (userId: string) => req<void>(`/api/users/${userId}`, { method: "DELETE" }),

  // family members
  listMembers: (id: string) => req<Member[]>(`/api/households/${id}/members`),
  createMember: (id: string, b: { name: string; monthlyGross?: number; monthlyTds?: number }) =>
    req<Member>(`/api/households/${id}/members`, { method: "POST", body: JSON.stringify(b) }),
  updateMember: (memberId: string, b: Partial<{ name: string; monthlyGross: number | null; monthlyTds: number | null }>) =>
    req<Member>(`/api/members/${memberId}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteMember: (memberId: string) => req<void>(`/api/members/${memberId}`, { method: "DELETE" }),
  memberAssessments: (id: string) => req<MemberAssessment[]>(`/api/households/${id}/members/assessment`),

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
  getAsset: (assetId: string) => req<Asset>(`/api/assets/${assetId}`),
  assetDetail: (assetId: string) => req<AssetDetail>(`/api/assets/${assetId}/detail`),
  updateAsset: (assetId: string, b: Partial<Asset>) =>
    req<Asset>(`/api/assets/${assetId}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteAsset: (assetId: string) => req<void>(`/api/assets/${assetId}`, { method: "DELETE" }),

  // valuations (appreciation history)
  listValuations: (assetId: string) => req<Valuation[]>(`/api/assets/${assetId}/valuations`),
  addValuation: (assetId: string, b: { value: number; asOf: string; source?: string }) =>
    req<Valuation>(`/api/assets/${assetId}/valuations`, { method: "POST", body: JSON.stringify(b) }),
  deleteValuation: (valuationId: string) => req<void>(`/api/valuations/${valuationId}`, { method: "DELETE" }),

  // asset photos
  listAssetPhotos: (assetId: string) => req<AssetPhoto[]>(`/api/assets/${assetId}/photos`),
  addAssetPhoto: (assetId: string, b: { dataUrl: string; caption?: string }) =>
    req<AssetPhoto>(`/api/assets/${assetId}/photos`, { method: "POST", body: JSON.stringify(b) }),
  deleteAssetPhoto: (photoId: string) => req<void>(`/api/photos/${photoId}`, { method: "DELETE" }),

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

  // compliance calendar
  listCompliance: (id: string) => req<ComplianceItem[]>(`/api/households/${id}/compliance`),
  complianceSummary: (id: string) => req<ComplianceSummary>(`/api/households/${id}/compliance/summary`),
  createCompliance: (id: string, b: Partial<ComplianceItem>) =>
    req<ComplianceItem>(`/api/households/${id}/compliance`, { method: "POST", body: JSON.stringify(b) }),
  completeCompliance: (itemId: string) =>
    req<{ completed: boolean; item: ComplianceItem | null }>(`/api/compliance/${itemId}/complete`, { method: "POST" }),
  deleteCompliance: (itemId: string) => req<void>(`/api/compliance/${itemId}`, { method: "DELETE" }),

  // audit trail (owner only)
  listAudit: (id: string) => req<AuditEntry[]>(`/api/households/${id}/audit`),

  // approval workflow
  listApprovals: (id: string) => req<Approval[]>(`/api/households/${id}/approvals`),
  approvalsSummary: (id: string) => req<{ pending: number }>(`/api/households/${id}/approvals/summary`),
  createApproval: (id: string, b: { title: string; amount?: number; note?: string }) =>
    req<Approval>(`/api/households/${id}/approvals`, { method: "POST", body: JSON.stringify(b) }),
  decideApproval: (approvalId: string, b: { decision: "approved" | "rejected"; note?: string }) =>
    req<Approval>(`/api/approvals/${approvalId}/decide`, { method: "POST", body: JSON.stringify(b) }),
  deleteApproval: (approvalId: string) => req<void>(`/api/approvals/${approvalId}`, { method: "DELETE" }),
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

/** Fired in-tab whenever the stored user changes, so the shell can update live
 * (the native `storage` event only fires in *other* tabs). */
export const USER_EVENT = "kunatra:user";
const announceUser = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(USER_EVENT)); };

export const saveSession = (s: Session) => {
  window.localStorage.setItem(TOKEN_KEY, s.token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(s.user));
  announceUser();
};

export const setStoredUser = (user: User) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  announceUser();
};

export const clearSession = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
};

/** The current user's household id (from the stored session). */
export const currentHousehold = () => getUser()?.householdId ?? null;
