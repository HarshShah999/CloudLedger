# CloudLedger

Cloud accounting for Indian businesses: double-entry books, GST invoicing, payments, banking and statutory reports, built with React, Node.js and PostgreSQL.

## Features

- **Double-entry engine**: every invoice, payment and journal posts a balanced voucher (checked to the paisa, inside one database transaction).
- **GST invoicing**: sales, purchase, credit note and debit note. CGST/SGST or IGST is chosen from the place of supply. Discounts apply before tax. Totals round to the nearest rupee through a Round Off ledger.
- **Automatic numbering** per document type and financial year (e.g. `INV/25-26/0001`), with GST's 16-character and uniqueness rules enforced.
- **Indian chart of accounts** created with every company (Tally-style groups such as Sundry Debtors, Duties & Taxes, Bank Accounts), plus system ledgers: Cash, Sales, Purchase, Input/Output CGST/SGST/IGST and Round Off.
- **One-click sharing**: a Share button on every invoice, credit/debit note and party statement:
  - **WhatsApp**, with the party's number and a ready-made message.
  - **Email**, with the PDF attached.
  - **Copy link**, **Download** and **Print**.
  - **More apps** on phones, which attaches the actual PDF to WhatsApp, Gmail, Telegram and so on.
- **Secure public links**: customers open the document without logging in, see what is due, pay with a **UPI button or QR code**, or download the PDF. Links expire and can be withdrawn.
- **GST-compliant PDFs**: HSN summary, CGST/SGST/IGST, amount in words, bank details, UPI QR and terms.
- **Audit trail (edit log)**: every create, change and delete, with the user, time and old → new values. It is recorded by database triggers in an append-only table, so it cannot be edited, deleted or switched off, as required by the Companies (Accounts) Rules, Rule 3(1). See the Audit Trail page and each invoice's History panel.
- **Invoice design**: your logo, signature/stamp and brand colour; Original/Duplicate/Triplicate copies; 80 mm thermal receipts for counter billing.
- **Bill-wise receipts & payments**: one receipt can settle several bills (auto-filled oldest-due first). Any extra money stays as an advance that you can adjust against later bills.
- **Outstanding (ageing)**: receivables and payables by not due / 1–30 / 31–60 / 61–90 / 90+ days, with a one-tap WhatsApp payment reminder per customer.
- **Books**: Day Book and Cash / Bank Book.
- **Quotation → Sales Order → Invoice** and **Purchase Order → Purchase Bill**, converted with one click. Quotations and orders never touch the books or stock until they become a bill.
- **GST compliance**:
  - GSTIN checksum validation, with state and PAN filled in from the GSTIN.
  - Registration types: regular, composition, unregistered, consumer, SEZ, overseas.
  - Place of supply by GST state code.
  - Exports and SEZ supplies, with or without payment (LUT), including shipping bill details.
  - Reverse charge on purchases.
  - TDS deducted on purchase bills, with the supplier owed the net amount.
- **GST returns**:
  - **GSTR-1 JSON** ready to upload on the GST portal: B2B, B2CL, B2CS, credit notes, exports, HSN summary split B2B/B2C, documents issued.
  - **GSTR-3B** tables 3.1 and 4 from your books.
  - **GSTR-2B upload and matching** against purchase bills, showing ITC at risk.
  - **TDS register** by section.
- **E-invoice and e-way bill**:
  - E-invoice JSON in the NIC INV-01 v1.1 schema, single or bulk, with a checklist of anything the IRP would reject.
  - Save the IRN, acknowledgement and signed QR; they print on the invoice, and the invoice is then locked.
  - E-way bill bulk-upload JSON built from transport details; flags goods over ₹50,000; records the EWB number.
- **Automatic payment reminders**:
  - Sent by email (PDF attached) and/or WhatsApp (Business Cloud API, approved template) on the days you choose around the due date.
  - Each reminder is sent once, every send is logged, and the WhatsApp token is stored encrypted.
- **Payments** against invoices into a chosen cash or bank account, with paid/partial/outstanding tracking.
- **Financial years**: the Indian April–March year is created automatically. A closed year is locked: nothing can be posted, edited or deleted in it.
- **Reports**: Trial Balance, Profit & Loss (with gross profit), Balance Sheet (always balances: includes current profit and any opening-balance difference), Ledger Statement with running balance, GSTR-1, GSTR-3B and Excel export.
- **Recurring invoices**: weekly, monthly, quarterly, half-yearly or yearly, with catch-up for missed periods.
- **Multi-company with per-company roles**: admin, accountant or viewer, enforced by the server on every request.
- Works on phones: responsive layout with a slide-out menu.
- Bank reconciliation, inventory quantities, email invoices with PDF, company export/import and full database backups.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Chart.js
- **Backend**: Node.js, Express 5, TypeScript, PostgreSQL (`pg`), Joi validation
- **Tests**: Vitest + Supertest (unit and API integration tests against a real database)

## Prerequisites

- Node.js 18+
- PostgreSQL 13+

## Setup

### 1. Database

```bash
createdb cloudledger
```

Tables are created by migrations (next step); there is no SQL to run by hand.

### 2. Backend

```bash
cd server
cp .env.example .env      # then edit it: DB_* and a long random JWT_SECRET are required
npm install
npm run migrate           # applies database/migrations/*.sql (also runs on server start)
npm run dev
```

Generate a JWT secret with `openssl rand -hex 48`. The server refuses to start without one.

Optional: `SECRETS_KEY` encrypts stored API tokens (defaults to the JWT secret; set it before saving a WhatsApp token if you plan to rotate the JWT secret).

Shared links point to `CLIENT_URL`. Set `PUBLIC_APP_URL` if the public address of the web app is different, for example `https://books.yourfirm.in`. Email sending needs the `SMTP_*` settings. Add your UPI ID and bank details under **Settings → Company & Invoice Settings**.

### 3. Frontend

```bash
cd client
cp .env.example .env      # VITE_API_URL, default http://localhost:8000/api
npm install
npm run dev
```

### 4. First login

Open the app and **Register**. The first account on a new installation becomes the platform administrator (the only account that can run full-database backup and restore). Then create your company. It is seeded with the chart of accounts, tax ledgers, voucher types and the current financial year.

Invite colleagues from **Users** (admin, accountant or viewer for that company).

## Tests

```bash
cd server
createdb cloudledger_test   # once; the integration tests wipe and rebuild this database
npm test
```

Set `TEST_DB_HOST`, `TEST_DB_USER`, `TEST_DB_PASSWORD` and `TEST_DB_NAME` if your test database differs from `postgres:postgres@localhost/cloudledger_test`. The test runner refuses to wipe a database whose name does not contain "test".

## Database migrations

- `database/migrations/NNNN_name.sql` files are applied in order and recorded in `schema_migrations`.
- `0001_baseline.sql` is idempotent: it also upgrades databases created by older versions of CloudLedger.
- Never edit a migration that has been released; add a new file instead.
- `database/legacy/` keeps the old scripts for reference only.

## Project Structure

- `client/`: React frontend
  - `src/lib/invoiceCalc.ts`: mirror of the server's GST calculator so forms preview exact totals
- `server/`: Express API
  - `src/services/`: business rules (posting engine, invoices, payments, reports, numbering, financial years)
  - `src/middleware/companyAccess.ts`: per-company authorization
  - `src/db/migrate.ts`: migration runner
  - `tests/`: unit and integration tests
- `database/migrations/`: schema migrations

## License

MIT
