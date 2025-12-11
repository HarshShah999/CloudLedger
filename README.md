# CloudLedger

A modern, cloud-based accounting application built with React, Node.js, and PostgreSQL.

## Features

- **Double-Entry Accounting**: Full support for debit/credit transactions.
- **Multi-Company**: Manage multiple companies with separate financial years.
- **Voucher System**: Sales, Purchase, Payment, Receipt, and Journal vouchers.
- **Real-time Reports**: Trial Balance, Profit & Loss (Coming Soon), Balance Sheet (Coming Soon).
- **Role-Based Access**: Admin, Accountant, Viewer roles.

## Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Chart.js
- **Backend**: Node.js, Express, TypeScript, PostgreSQL
- **Database**: PostgreSQL

## Prerequisites

- Node.js (v16+)
- PostgreSQL (v13+)

## Setup Instructions

### 1. Database Setup

1. Create a PostgreSQL database named `cloudledger`.
2. Run the schema script located at `database/schema.sql`.
3. Run the seed script located at `database/seed.sql` to populate initial data.

### 2. Backend Setup

1. Navigate to the `server` directory:
   ```bash
   cd server
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file based on the example provided in the code or use the following:
   ```env
   PORT=5000
   DB_USER=postgres
   DB_PASSWORD=password
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=cloudledger
   JWT_SECRET=your_jwt_secret_key
   CLIENT_URL=http://localhost:5173
   ```
4. Start the server:
   ```bash
   npm run dev
   ```

### 3. Frontend Setup

1. Navigate to the `client` directory:
   ```bash
   cd client
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

## Default Credentials

- **Email**: info@democompany.com
- **Password**: password (Note: You may need to register a new user if seed data doesn't include a user with known password hash, but the seed script sets up the company structure. Use the Register page to create your first admin user.)

## Project Structure

- `client/`: React frontend application
- `server/`: Node.js Express backend API
- `database/`: SQL scripts for schema and seed data

## License

MIT
