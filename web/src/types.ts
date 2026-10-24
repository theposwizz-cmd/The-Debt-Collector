export interface Member {
  id: number;
  name: string;
  email: string | null;
}

export interface Transfer {
  id: number;
  from: string;
  to: string;
  amountCents: number;
  amount: string;
  status: "open" | "paid" | "cancelled";
  paypalStatus: string | null;
  invoiceUrl: string | null;
  invoiceId: string | null;
  error: string | null;
  /** When PayPal was last asked about this invoice (real time, ms). */
  checkedAt: number | null;
}

/** What one PayPal status check found, as the server logged it. */
export interface PaymentCheckResult {
  kind: "paid" | "partial" | "awaiting" | "cancelled" | "refunded" | "unknown" | "error";
  status: string | null;
  message: string;
  changed: boolean;
}

export interface ExpenseView {
  id: number;
  description: string;
  amount: string;
  paidBy: string;
  split: string;
  shares: { member: string; share: string }[];
  source: string;
  voided?: boolean;
  receipt?: { merchant: string | null; imageUrl: string | null };
}

export type Card =
  | { type: "members"; group: string | null; members: { name: string; email: string | null }[] }
  | { type: "expense"; label: string; expense: ExpenseView }
  | { type: "transfers"; transfers: Transfer[]; note?: string }
  | {
      type: "balances";
      currency: string;
      balances: { member: string; netCents: number; net: string }[];
      history?: { members: string[]; points: { t: number; label: string; values: number[] }[] };
    }
  | { type: "payment"; from: string; to: string; amount: string; method: string; note?: string | null }
  | {
      type: "debts";
      currency: string;
      debtors: { member: string; owesCents: number; owes: string; to: { member: string; amountCents: number; amount: string }[] }[];
      creditors: { member: string; owedCents: number; owed: string }[];
    };

export interface ChatMessage {
  id: number;
  role: "user" | "agent" | "system";
  kind: string;
  authorId: number | null;
  authorName: string | null;
  content: string;
  data: any;
  createdAt: number;
}

export interface AppState {
  group: { id: number; name: string | null; currency: string };
  members: Member[];
  messages: ChatMessage[];
  transfers: Transfer[];
  balances: { memberId: number; name: string; netCents: number; budgetCents: number | null; spentCents: number }[];
  clock: { now: number; offsetDays: number };
  config: { anthropic: boolean; paypal: boolean; model: string };
  /** Every saved case, most recently active first. */
  cases: CaseSummary[];
}

export interface CaseSummary {
  id: number;
  name: string | null;
  members: string[];
  createdAt: number;
  lastAt: number;
  lastMessage: string | null;
  openCents: number;
  spentCents: number;
}
