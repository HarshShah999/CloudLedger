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
