-- Seed Data

-- Insert Default Company
INSERT INTO companies (id, name, address, email, phone, currency) VALUES 
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Demo Company Ltd.', '123 Cloud Street, Tech City', 'info@democompany.com', '9876543210', 'INR');

-- Insert Financial Year
INSERT INTO financial_years (id, company_id, name, start_date, end_date, is_active) VALUES
('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2024-2025', '2024-04-01', '2025-03-31', true);

-- Insert Ledger Groups (Base Groups)
INSERT INTO ledger_groups (id, company_id, name, type, parent_id) VALUES
('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Assets', 'Asset', NULL),
('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Liabilities', 'Liability', NULL),
('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Income', 'Income', NULL),
('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Expenses', 'Expense', NULL);

-- Sub Groups
INSERT INTO ledger_groups (id, company_id, name, type, parent_id) VALUES
(uuid_generate_v4(), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Current Assets', 'Asset', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'),
(uuid_generate_v4(), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Bank Accounts', 'Asset', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'),
(uuid_generate_v4(), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Cash-in-Hand', 'Asset', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'),
(uuid_generate_v4(), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Sundry Debtors', 'Asset', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'),
(uuid_generate_v4(), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Sundry Creditors', 'Liability', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44'),
(uuid_generate_v4(), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Sales Accounts', 'Income', 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55'),
(uuid_generate_v4(), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Purchase Accounts', 'Expense', 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66');

-- Insert Voucher Types
INSERT INTO voucher_types (id, company_id, name) VALUES
(uuid_generate_v4(), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Sales'),
(uuid_generate_v4(), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Purchase'),
(uuid_generate_v4(), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Payment'),
(uuid_generate_v4(), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Receipt'),
(uuid_generate_v4(), 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Journal');
