# The Debt Collector

**A group money app that is entirely a chat with one AI agent.**

The Debt Collector is your group's shared "money brain". You talk to it in plain language. It keeps the ledger, reads receipts, works out the fewest payments needed to settle everyone, sends real **PayPal (sandbox)** payment requests, chases unpaid debts on its own with escalating nudges, and handles disputes. It does all of this in the voice of a calm, unbothered debt collector with a very long memory.

> "Marko, I have reminded you three times. I have nothing but time and a very long memory. The €238.12."

Built for the PayPal AI Hackathon. **Claude** (Anthropic API) does the reasoning and **PayPal Invoicing** moves the money.

> **Sandbox only. No real money moves.** Every PayPal call goes to `api-m.sandbox.paypal.com`; live mode is deliberately not wired up. Invoices are paid with PayPal sandbox test accounts.

**Contents:** [Features](#what-it-does) · [Tech stack](#tech-stack) · [Run locally](#setup) · [Deploy to Render](#deploy-to-render) · [Demo script](#demo-script-3-minutes) · [Limitations](#honest-limitations)

## Features at a glance

- **One chat, one agent.** Talk in plain language; Claude turns it into ledger actions through typed tools.
- **Receipt photos** (JPEG, PNG, WebP, HEIC) read by Claude vision.
- **Flexible splits:** even, subsets of people, custom amounts.
- **Ledger Q&A and disputes:** "Has Marko paid me back?", "I wasn't at that dinner."
- **Settle up** with the minimum number of transfers, as real **PayPal sandbox invoices**.
- **Automatic chasing:** reminders on day 0, 2 and 4+, escalating from polite to comically menacing (always PG), with a demo clock to fast-forward.
- **Payment detection:** paid invoices flip from UNSETTLED to SETTLED on their own; cash/bank payments can be marked settled.
- **New-group survey**, **trip budgets**, **saved cases**, balance charts and a "who owes whom" ranking.

---

## What it does

Everything happens in one chat. The only form is a short survey when you start a group, and tables appear only when you ask for them.

### Starting a group

**New group** opens a four-page survey, one question per page:
1. What's the group for? (trip, shared flat, class, event, couple, team, something else)
2. Your name.
3. Who else is in it.
4. Trips and events only: **where everyone stands right now.**
   - **Starting budget:** how much each person is bringing.
   - **Owed / owes:** debts that already exist before the app took over. They have to cancel out.

The case opens with everyone on file, so The Collector never asks setup questions. You go straight to "I paid 600 for the villa".

### Saved cases

Every group you make stays on file. Home lists your cases with who's in them, what's been spent, what's still owed and when each was last active; tap one to pick up where it left off. You can also jump between cases from **⋯ → Switch case** in the chat. The app reopens the last case you were in, and remembers who you were speaking as in each one.

### Personal budgets

On trips, each person's share of every expense comes out of what they brought. The **Subjects** panel shows a bar per person ("€161.88 of €400.00 left") that turns amber under 20% and red once they're over. The Collector knows the numbers ("how much of my budget is left?") and can change them ("Ana's budget is €200"). Budgets never affect who owes whom, and opening debts don't count as spending.

### In the chat

| You say… | The Debt Collector… |
|---|---|
| "New group for Hvar. Me, Ana, Luka and Marko. Euros." | creates the group and members, and asks for emails |
| "I paid 600 for the villa, split evenly" | books the expense at €150 each |
| "The boat trip only between Ana, Luka, Marko and me, 280, Ana paid" | splits it among exactly those people |
| 📷 *uploads a receipt photo* | reads the merchant, total, date and items with Claude vision, confirms them in chat, and asks who paid |
| "Who owes the most?" / "Has Marko paid me back?" | answers from the ledger with exact figures; "who owes whom" gets a ranked card showing who pays whom |
| "Show balances" | draws a smooth line chart of everyone's balance over time |
| "I wasn't even at that dinner" | checks the ledger, then fixes the split or explains why the charge stands |
| "Settle up" | computes the **minimum set of transfers**, sends a **PayPal sandbox invoice** for each one, and posts a request to each person who owes, marked UNSETTLED until it's paid, then SETTLED. Only the person who owes sees the PayPal button; only the person owed can mark it settled |
| "How much of my budget is left?" | answers from the trip budgets |
| *(nothing)* | while a debt is unpaid, posts reminders on day 0, day 2 and day 4+, each one more pointed, and stays PG |
| "Marko gave me the cash" | records the payment and marks the PayPal invoice paid |

### How AI and PayPal are used

- **Claude (`claude-opus-5-5` by default)**
  - **The agent loop.** Claude reads the chat and calls typed tools (`add_expense`, `settle_up`, `update_expense`, `record_payment`, …). Intent routing, parsing amounts and split rules from language, ledger Q&A and dispute reasoning all happen here. All arithmetic is done in deterministic code. The model never does sums in its head.
  - **Receipt vision.** The photo goes to Claude with a JSON schema (structured outputs), and the answer comes back as typed data.
  - **Nudge writing.** For each reminder, Claude gets the debt, the escalation level and the earlier reminders, and writes a new line in voice.
  - Server-side refusal fallback is enabled (`fallbacks: "default"`).
- **PayPal REST API (sandbox), Invoicing v2**
  - `settle_up` creates and sends one invoice per transfer, and stores the payer link and status.
  - A background job polls each invoice every ~15 s (`GET /v2/invoicing/invoices/{id}`), matched by the invoice id stored on the request:
    - `PAID` / `MARKED_AS_PAID`: books the payment, flips the request to SETTLED, posts a confirmation, stops the chasing.
    - `PARTIALLY_PAID`: says how much arrived; the request stays open until it's paid in full.
    - `CANCELLED` (on PayPal's side): loud error, the debt stays open. `REFUNDED`: the payment is removed and the debt reopens.
    - A failed check (auth, network, unknown invoice) is logged and shown on the request in full. It's never treated as paid or as "not paid yet".
  - Every poll is logged on the server (`[paypal] #12 INV2-… Marko → Filip €90: SENT, not paid yet`). **Check payment now** on a request, or **Check all payments now** in the demo clock menu, asks PayPal immediately.
  - When the ledger changes and you settle up again, the old invoices are cancelled and new ones go out.
  - Payments made outside PayPal (cash) are recorded on the invoice with `POST /invoices/{id}/payments`.

### Settle-up algorithm

Each person's net balance is `paid − share + repayments sent − repayments received`. The algorithm repeatedly matches the biggest creditor with the biggest debtor and moves `min(credit, debt)`. Each step zeroes at least one person, so a group of *n* never needs more than *n − 1* transfers. It works in integer cents and gives deterministic results when amounts tie. See [`server/src/settle.ts`](server/src/settle.ts) and its tests.

---

## Tech stack

| Layer | What |
|---|---|
| AI | Claude via the Anthropic TypeScript SDK: tool-use agent loop, vision for receipts, structured outputs (Zod) |
| Payments | PayPal REST API, **sandbox**: OAuth client credentials + Invoicing v2 |
| Server | Node.js 22+ (24 recommended), Express, TypeScript run with `tsx`, Server-Sent Events for live updates |
| Data | SQLite (`better-sqlite3`), money as integer cents |
| Images | `sharp` + `heic-convert` (HEIC → JPEG, rotate, downscale) |
| Web | React 19, Vite, Tailwind CSS v4, Framer Motion |
| Tests | Vitest (settle-up algorithm, ledger, splits, nudges, images, survey, cases, rate limit) |

---

## Setup

Requirements: **Node.js 22+** (24 recommended) and npm.

```bash
git clone <this repo> debt-collector && cd debt-collector
npm install
cp .env.example .env      # then fill in ANTHROPIC_API_KEY, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET
npm run dev               # API on :3001, web on http://localhost:5173
```

Open **http://localhost:5173** and click **Load demo group**.

For a single production-style process (Express serves the built UI and the API on one port, `PORT` or 3001):

```bash
npm run build
npm start
```

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Claude |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | yes | PayPal **sandbox** REST app |
| `ANTHROPIC_MODEL` | no | default `claude-opus-5-5` |
| `DATABASE_PATH`, `UPLOAD_DIR` | no | default `./data/debt-collector.db`, `./data/uploads` |
| `AI_RATE_LIMIT_PER_MIN` | no | AI requests per visitor IP per minute, default 20 |
| `SEED_DEMO` | no | seed the demo when the database is empty, default on (`false` to disable) |
| `PORT` / `API_PORT` | no | production port (hosts set `PORT`) / dev API port |

Run the tests:

```bash
npm test
```

## Deploy to Render

The repo includes a [`render.yaml`](render.yaml) Blueprint: **Render → New → Blueprint → pick this repo**, then paste the three secrets when asked. Or create a **Web Service** by hand:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check path | `/healthz` |
| Environment | `NODE_VERSION=24`, `ANTHROPIC_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` |

Notes for the free tier:
- **The disk is ephemeral.** The SQLite database is wiped on every redeploy or restart. On an empty database the server seeds the Hvar Trip demo at startup, and **Load demo group** always rebuilds it from code and the bundled sample receipt, so the demo never depends on saved data. For persistence, attach a disk and set `DATABASE_PATH` / `UPLOAD_DIR` onto it.
- **It sleeps when idle.** The first request after a nap takes 30–50 s while Render wakes the service; the app's loading screen waits and retries calmly. Ping `GET /healthz` (returns `200 {"ok":true}`) to wake it before a demo.
- **Abuse protection.** Endpoints that spend Claude credits (chat messages, receipt uploads, demo fast-forward) are limited per visitor IP, 20 per minute by default. A normal demo never gets near it; past it, the visitor gets a polite "try again in Ns".

### Get an Anthropic API key

1. Sign in at https://console.anthropic.com.
2. Go to **Settings → API keys → Create key**.
3. Put it in `.env` as `ANTHROPIC_API_KEY=...`.

Optional: set `ANTHROPIC_MODEL` in `.env` to use another Claude model.

### Get PayPal sandbox credentials

1. Sign in at https://developer.paypal.com (any PayPal account works).
2. Open **Apps & Credentials** and make sure the toggle says **Sandbox**.
3. **Create App** (type: Merchant). Copy the **Client ID** and **Secret** into `.env` as `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
4. Under **Testing tools → Sandbox accounts** you'll find a sandbox *business* account (the one that owns the app, which issues the invoices) and a sandbox *personal* account (use it to pay one).

The app only talks to `api-m.sandbox.paypal.com`. Live mode is not wired up on purpose.

### Receipt photos

Receipts can be JPEG, PNG, WebP, GIF or **HEIC/HEIF** (iPhone). HEIC is converted to JPEG on the server, and large photos are rotated upright and downscaled to 2000 px so they stay under Claude's image limit. If a photo can't be read or converted, the chat says exactly why. `samples/receipt-tommy-iphone.heic` is a HEIC sample for testing.

### Troubleshooting: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

If Claude or PayPal calls fail with "could not be reached" and a certificate error, something on your machine is inspecting HTTPS traffic (antivirus HTTPS scanning or a company proxy). The server already trusts the operating system's certificate store in addition to Node's own. If it still fails, add that tool's root certificate to the OS store, or point `NODE_EXTRA_CA_CERTS` at it.

### Instant chips

The **Show balances**, **Who owes the most?** and **Settle up** suggestion chips are handled straight from the ledger (`POST /api/quick`), with no AI call, so they work instantly even without an Anthropic key. Typing the same thing goes to The Collector, which produces the same cards and requests through its tools.

Each settlement request has **Mark as settled** for money paid outside PayPal (cash, bank). It records the payment and, if there's a PayPal invoice, marks that paid too.

### Missing keys

Nothing is mocked. If a key is missing, the server says so at startup, the UI shows a banner, and any action that needs the key posts a clear error into the chat. It never invents a response.

- Without PayPal keys, settle-up still computes the transfers and posts the requests, but each one says no PayPal request was sent. You can still use **Mark as settled**.
- Without an Anthropic key, automatic payment reminders are paused. The banner already explains why.

---

## Demo script (≈3 minutes)

1. **Load demo group.** It seeds "Hvar Trip": five people with personal budgets, a villa, a boat trip split among a subset, a dinner from a receipt photo, groceries, one bank-transfer repayment, and a budget question (Marko is over, Luka is nearly out). This is seed data only. Everything after this point makes real calls. Reloading the demo replaces the previous demo copy and never touches your own cases.
   - Open the **Subjects** panel in the header to see balances and budget bars.
   - Go **Home** to see the saved-cases list. Then try **New group → Trip** to walk through the survey with budgets.
2. Use **Speaking as** in the header to switch between people. "I" always means whoever is selected.
3. Upload `samples/receipt-tommy.jpg` with the 📷 button. Claude reads it, and you reply "I paid, split between me, Ana and Iva".
4. Ask: *"Who owes the most?"*
5. As Marko: *"I wasn't at the boat trip, why am I paying for it?"* Watch it decide, then fix the split or explain.
6. *"Settle up."* Real sandbox invoices appear with **PayPal** buttons, and reminder #1 lands.
7. Use the **clock button** (⏩ +2 days, a few times) to watch the reminders escalate from polite, to pointed, to long memory.
8. Pay one invoice. Either:
   - Open the PayPal link and pay with your sandbox personal account. For that, set the debtor's email to your sandbox buyer's email first: *"Marko's email is sb-xxxx@personal.example.com"*, then *"settle up"* again.
   - Or say *"Marko paid me in cash"*.

   The Debt Collector records the payment and the chasing stops.

### Sample files

- `samples/receipt-konoba-mate.jpg` is used by the demo seed.
- `samples/receipt-tommy.jpg` is for a live upload.
- `scripts/make-sample-receipts.py` regenerates both (needs Pillow).

---

## Architecture

```
web/      React + TypeScript + Vite + Tailwind + Framer Motion. Mobile-first, live via SSE.
  src/screens/         loading, Home (hero + saved cases), new-group survey
  src/components/      chat, cards, charts, header (subjects, budgets, menu)
server/   Express + TypeScript (run with tsx)
  src/ai/agent.ts      Claude tool-use loop and tool implementations
  src/ai/receipt.ts    Claude vision → structured receipt data
  src/ai/nudge.ts      escalation ladder + Claude-written reminders
  src/ai/prompts.ts    persona and system prompts
  src/ledger.ts        SQLite repository: cases, members, budgets, expenses, shares, payments, transfers, messages
  src/setup.ts         new-group survey → a ready case (opening balances, budgets)
  src/demo.ts          the "Hvar Trip" demo seed
  src/settle.ts        minimum-transfers algorithm (unit-tested)
  src/settlement.ts    settle-up orchestration ↔ PayPal
  src/paypal.ts        PayPal sandbox OAuth + Invoicing v2
  src/scheduler.ts     background chaser (PayPal status refresh + nudges)
  src/clock.ts         simulated clock for the "fast-forward" demo control
  src/ratelimit.ts     per-IP limit on routes that spend Claude credits
data/     debt-collector.db (SQLite) and uploaded receipt images. Created on first run, git-ignored.
```

- Money is stored as integer cents.
- The chat history, ledger and invoices of every case all live in one SQLite file, so nothing is lost on restart.
- The demo clock is real time plus a stored offset. Fast-forwarding moves the offset and immediately runs the chaser.

### Honest limitations

- **Who issues the invoice.** In the sandbox, every invoice comes from the sandbox business account that owns the REST app, "on behalf of" the creditor, whose name is on the invoice. To have each person request money from their own PayPal account, you'd need PayPal's partner/marketplace onboarding.
- **One currency per group.** If an expense is in another currency, The Debt Collector asks for the converted amount instead of guessing an exchange rate.
- **No real accounts.** "Speaking as" is a picker, not authentication. That's fine for a demo and not fine for production.
- **One shared workspace.** On a public deployment every visitor sees the same cases. Reloading the demo resets it for everyone.
- **Ephemeral hosting.** On Render's free tier, cases disappear on redeploy/restart (the demo comes back automatically).
- **Payment detection is polling,** every ~15 s, not PayPal webhooks, so a sandbox payment shows as SETTLED a few seconds after it's made.
- **The demo clock** fast-forwards the whole app at once; it's a demo control, not a per-group setting.

## License

[MIT](LICENSE)
