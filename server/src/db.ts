import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DATABASE_PATH } from "./config.js";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT,
  currency    TEXT NOT NULL DEFAULT 'EUR',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT,
  budget_cents INTEGER,                   -- personal trip budget (money they brought), optional
  created_at  INTEGER NOT NULL,
  UNIQUE (group_id, name COLLATE NOCASE)
);

CREATE TABLE IF NOT EXISTS expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  payer_id      INTEGER NOT NULL REFERENCES members(id),
  description   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  split_type    TEXT NOT NULL,            -- even | custom | weights
  source        TEXT NOT NULL DEFAULT 'text', -- text | receipt
  receipt_id    INTEGER REFERENCES receipts(id),
  spent_at      INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  voided_at     INTEGER,
  void_reason   TEXT
);

CREATE TABLE IF NOT EXISTS expense_shares (
  expense_id    INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id     INTEGER NOT NULL REFERENCES members(id),
  share_cents   INTEGER NOT NULL,
  PRIMARY KEY (expense_id, member_id)
);

CREATE TABLE IF NOT EXISTS receipts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  image_path  TEXT,
  extracted   TEXT NOT NULL,              -- JSON from Claude vision
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_id       INTEGER NOT NULL REFERENCES members(id),
  to_id         INTEGER NOT NULL REFERENCES members(id),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  method        TEXT NOT NULL DEFAULT 'manual', -- manual | paypal
  transfer_id   INTEGER REFERENCES transfers(id),
  note          TEXT,
  paid_at       INTEGER NOT NULL
);

-- A settle-up debt. One PayPal invoice each. Chased by the scheduler while unpaid.
CREATE TABLE IF NOT EXISTS transfers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id            INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_id             INTEGER NOT NULL REFERENCES members(id),
  to_id               INTEGER NOT NULL REFERENCES members(id),
  amount_cents        INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'open',   -- open | paid | cancelled
  paypal_invoice_id   TEXT,
  paypal_invoice_url  TEXT,
  paypal_status       TEXT,
  paypal_error        TEXT,
  nudge_count         INTEGER NOT NULL DEFAULT 0,
  last_nudge_at       INTEGER,
  created_at          INTEGER NOT NULL,
  closed_at           INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,              -- user | agent | system
  kind        TEXT NOT NULL DEFAULT 'text', -- text | nudge | error
  author_id   INTEGER REFERENCES members(id),
  content     TEXT NOT NULL,
  data        TEXT,                       -- JSON: cards, image url, nudge level...
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let instance: DB | null = null;

export function openDb(file?: string): DB {
  if (file && file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file ?? ":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  // Migrations for databases created before a column existed.
  const memberCols = (db.prepare("PRAGMA table_info(members)").all() as { name: string }[]).map((c) => c.name);
  if (!memberCols.includes("budget_cents")) db.exec("ALTER TABLE members ADD COLUMN budget_cents INTEGER");
  return db;
}

export function getDb(): DB {
  if (!instance) instance = openDb(DATABASE_PATH);
  return instance;
}

/** Tests swap in an in-memory database. */
export function setDb(db: DB): void {
  instance = db;
}
