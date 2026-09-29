# AccountantAI Database Schema

A production-ready PostgreSQL database schema for an AI-powered accounting platform.

## Overview

This schema supports:
- ✅ Multi-tenant architecture (firms with multiple clients)
- ✅ Double-entry bookkeeping
- ✅ Bank integration and reconciliation
- ✅ Document management (OCR receipts)
- ✅ AI training and feedback loops
- ✅ Tax preparation and filing
- ✅ Comprehensive audit trails
- ✅ Cash flow forecasting

## Quick Start

### 1. Install PostgreSQL

```bash
# macOS
brew install postgresql@14
brew services start postgresql@14

# Ubuntu/Debian
sudo apt-get install postgresql-14

# Docker
docker run --name accountantai-postgres \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=accountantai \
  -p 5432:5432 \
  -d postgres:14
```

### 2. Create Database

```bash
# Connect to PostgreSQL
psql postgres

# Create database
CREATE DATABASE accountantai;

# Exit
\q
```

### 3. Run Schema

```bash
# Apply the schema
psql accountantai < schema.sql

# Verify tables created
psql accountantai -c "\dt"
```

## Schema Structure

### Core Entities

**Users & Authentication**
- `users` - User accounts (accountants, clients)
- `roles` - Permission levels
- `sessions` - Login sessions
- `firms` - Accounting firms (multi-tenant)

**Clients & Businesses**
- `clients` - Client businesses
- `accounts` - Chart of accounts
- `account_types` - Asset, Liability, Equity, Revenue, Expense
- `account_categories` - Sub-categories

**Transactions**
- `transactions` - Journal entry headers
- `transaction_lines` - Double-entry lines (debits/credits)
- `bank_accounts` - Connected bank accounts (via Plaid)
- `bank_transactions` - Imported bank transactions

**Documents**
- `documents` - Receipts, invoices, contracts
- `document_entities` - Extracted data (OCR results)

**Tax Management**
- `tax_forms` - 1040, 1120, etc.
- `tax_deductions` - Tracked deductions
- `estimated_tax_payments` - Quarterly payments

**Reporting & Analytics**
- `reports` - Saved/scheduled reports
- `cash_flow_forecasts` - AI-powered forecasts

**AI & Machine Learning**
- `ai_training_data` - Categorization training data
- `ai_models` - Model versions and performance
- `ai_queries` - Conversational AI interactions

**Compliance**
- `audit_log` - Complete audit trail
- `data_exports` - GDPR data exports
- `notifications` - User alerts

## Key Design Decisions

### 1. Double-Entry Bookkeeping

Every transaction has balanced debits and credits:

```sql
-- Example: $1,000 payment from bank to vendor
INSERT INTO transactions (client_id, transaction_date, description) 
VALUES ('client-uuid', '2026-01-15', 'Payment to supplier');

INSERT INTO transaction_lines (transaction_id, account_id, credit_amount) 
VALUES (txn_id, bank_account_id, 1000.00);  -- Credit bank (decrease asset)

INSERT INTO transaction_lines (transaction_id, account_id, debit_amount) 
VALUES (txn_id, expense_account_id, 1000.00);  -- Debit expense (increase expense)
```

**Constraint**: Each transaction_line must have EITHER debit OR credit, not both.

### 2. Multi-Tenant Architecture

Data is isolated by `firm_id` and `client_id`:

```sql
-- Accountant sees all their clients
SELECT * FROM clients WHERE firm_id = 'accountant-firm-uuid';

-- Client sees only their data
SELECT * FROM transactions WHERE client_id = 'specific-client-uuid';
```

**Important**: Always filter by `firm_id` or `client_id` to prevent data leakage.

### 3. Soft Deletes

Most tables use `is_active` or `status` instead of hard deletes:

```sql
-- Don't do this
DELETE FROM clients WHERE id = 'client-uuid';

-- Do this instead
UPDATE clients SET status = 'archived' WHERE id = 'client-uuid';
```

**Reason**: Preserve audit trail and historical data.

### 4. Denormalized Balances

Account balances are cached in `accounts.current_balance`:

```sql
-- Update balance after posting transaction
UPDATE accounts 
SET current_balance = (
    SELECT CASE 
        WHEN normal_balance = 'DEBIT' THEN SUM(debit) - SUM(credit)
        ELSE SUM(credit) - SUM(debit)
    END
    FROM transaction_lines
    WHERE account_id = accounts.id
)
WHERE id = 'account-uuid';
```

**Trade-off**: Faster reads, must keep in sync with transactions.

### 5. AI Feedback Loop

Track AI predictions and corrections for model improvement:

```sql
-- Store AI prediction
INSERT INTO transactions (description, ai_suggested_category, ai_confidence_score)
VALUES ('Starbucks', 'Meals & Entertainment', 0.92);

-- User corrects it
UPDATE transactions SET account_id = 'correct-account-id' WHERE id = 'txn-uuid';

-- Log for training
INSERT INTO ai_training_data (description, predicted_category, actual_category, was_correct)
VALUES ('Starbucks', 'Meals & Entertainment', 'Office Supplies', false);
```

**Result**: Model learns from mistakes over time.

## Common Queries

### Get Client's Profit & Loss

```sql
SELECT 
    a.name AS account_name,
    SUM(tl.debit_amount) - SUM(tl.credit_amount) AS amount
FROM transaction_lines tl
JOIN transactions t ON tl.transaction_id = t.id
JOIN accounts a ON tl.account_id = a.id
JOIN account_types at ON a.account_type_id = at.id
WHERE t.client_id = 'client-uuid'
  AND t.transaction_date BETWEEN '2026-01-01' AND '2026-12-31'
  AND at.name IN ('Revenue', 'Expense')
  AND t.status = 'posted'
GROUP BY a.id, a.name, at.name
ORDER BY at.name, a.name;
```

### Get Balance Sheet

```sql
SELECT 
    at.name AS account_type,
    a.name AS account_name,
    CASE 
        WHEN at.normal_balance = 'DEBIT' THEN 
            SUM(tl.debit_amount) - SUM(tl.credit_amount)
        ELSE 
            SUM(tl.credit_amount) - SUM(tl.debit_amount)
    END AS balance
FROM accounts a
JOIN account_types at ON a.account_type_id = at.id
LEFT JOIN transaction_lines tl ON a.id = tl.account_id
LEFT JOIN transactions t ON tl.transaction_id = t.id
WHERE t.client_id = 'client-uuid'
  AND t.transaction_date <= '2026-12-31'
  AND t.status = 'posted'
  AND at.name IN ('Asset', 'Liability', 'Equity')
GROUP BY at.id, at.name, a.id, a.name, at.normal_balance
ORDER BY at.display_order, a.account_number;
```

### Find Unmatched Bank Transactions

```sql
SELECT 
    bt.transaction_date,
    bt.description,
    bt.amount,
    bt.suggested_category,
    bt.ai_confidence_score
FROM bank_transactions bt
JOIN bank_accounts ba ON bt.bank_account_id = ba.id
WHERE ba.client_id = 'client-uuid'
  AND bt.is_matched = false
  AND bt.status = 'pending'
ORDER BY bt.transaction_date DESC;
```

### AI Training Data Performance

```sql
SELECT 
    category_name,
    COUNT(*) AS total_predictions,
    SUM(CASE WHEN was_prediction_correct THEN 1 ELSE 0 END) AS correct_predictions,
    ROUND(100.0 * SUM(CASE WHEN was_prediction_correct THEN 1 ELSE 0 END) / COUNT(*), 2) AS accuracy_pct
FROM ai_training_data
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY category_name
ORDER BY total_predictions DESC;
```

## Migrations

### Adding a New Column

```sql
-- migrations/001_add_client_logo.sql
ALTER TABLE clients 
ADD COLUMN logo_url VARCHAR(500);

COMMENT ON COLUMN clients.logo_url IS 'S3 URL to client logo';
```

### Creating a New Table

```sql
-- migrations/002_add_budgets_table.sql
CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id),
    budget_year INTEGER NOT NULL,
    monthly_amounts DECIMAL(15,2)[12],  -- Array for each month
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_budgets_client_id ON budgets(client_id);
```

### Migration Tracking

```sql
-- Track applied migrations
CREATE TABLE schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    description TEXT,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Record migration
INSERT INTO schema_migrations (version, description) 
VALUES ('001', 'Add client logo URL');
```

## Performance Optimization

### 1. Explain Analyze

```sql
-- Check query performance
EXPLAIN ANALYZE
SELECT * FROM transactions 
WHERE client_id = 'client-uuid' 
  AND transaction_date BETWEEN '2026-01-01' AND '2026-12-31';
```

### 2. Add Indexes

```sql
-- If querying by multiple columns frequently
CREATE INDEX idx_transactions_client_date 
ON transactions(client_id, transaction_date);

-- Partial index for pending transactions
CREATE INDEX idx_transactions_pending 
ON transactions(client_id) 
WHERE status = 'pending';
```

### 3. Vacuum and Analyze

```sql
-- Regular maintenance
VACUUM ANALYZE transactions;

-- Or all tables
VACUUM ANALYZE;
```

## Security Best Practices

### 1. Encrypt Sensitive Data

```sql
-- Use pgcrypto for sensitive fields
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Encrypt SSN/EIN
UPDATE clients 
SET tax_id = pgp_sym_encrypt(tax_id, 'encryption-key');

-- Decrypt when needed
SELECT 
    business_name,
    pgp_sym_decrypt(tax_id::bytea, 'encryption-key') AS tax_id
FROM clients;
```

### 2. Row-Level Security (RLS)

```sql
-- Enable RLS on clients table
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their firm's clients
CREATE POLICY clients_firm_isolation ON clients
    FOR SELECT
    USING (firm_id = current_setting('app.current_firm_id')::UUID);

-- Set firm_id in application code
SET app.current_firm_id = 'firm-uuid';
```

### 3. Audit Logging

```sql
-- Trigger to log all changes
CREATE OR REPLACE FUNCTION log_audit()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_log (
        user_id, 
        action, 
        resource_type, 
        resource_id, 
        old_values, 
        new_values
    ) VALUES (
        current_setting('app.current_user_id')::UUID,
        TG_OP,
        TG_TABLE_NAME,
        NEW.id,
        row_to_json(OLD),
        row_to_json(NEW)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to sensitive tables
CREATE TRIGGER audit_transactions
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION log_audit();
```

## Backup & Recovery

### Automated Backups

```bash
# Daily backup script
#!/bin/bash
DATE=$(date +%Y%m%d)
pg_dump accountantai | gzip > /backups/accountantai-$DATE.sql.gz

# Keep last 30 days
find /backups -name "accountantai-*.sql.gz" -mtime +30 -delete
```

### Point-in-Time Recovery

```bash
# Enable WAL archiving in postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'cp %p /archive/%f'

# Restore to specific time
pg_restore -d accountantai -T '2026-01-15 14:30:00' backup.sql
```

## Testing

### Sample Data

```sql
-- Insert test firm
INSERT INTO firms (id, name) VALUES 
('00000000-0000-0000-0000-000000000001', 'Test Firm');

-- Insert test user
INSERT INTO users (id, email, password_hash, first_name, last_name, firm_id, role_id)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    'test@accountantai.com',
    '$2a$10$test...', -- bcrypt hash of 'password123'
    'Test',
    'User',
    '00000000-0000-0000-0000-000000000001',
    2  -- accountant role
);

-- Insert test client
INSERT INTO clients (id, firm_id, user_id, business_name, tax_id)
VALUES (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'Test Business LLC',
    '12-3456789'
);
```

### Integration Tests

```sql
-- Test: Double-entry bookkeeping is balanced
SELECT 
    transaction_id,
    SUM(debit_amount) AS total_debits,
    SUM(credit_amount) AS total_credits,
    SUM(debit_amount) - SUM(credit_amount) AS difference
FROM transaction_lines
GROUP BY transaction_id
HAVING SUM(debit_amount) != SUM(credit_amount);

-- Should return 0 rows (all balanced)
```

## Monitoring

### Key Metrics to Track

```sql
-- Database size
SELECT pg_size_pretty(pg_database_size('accountantai'));

-- Table sizes
SELECT 
    table_name,
    pg_size_pretty(pg_total_relation_size(table_name::regclass)) AS size
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY pg_total_relation_size(table_name::regclass) DESC;

-- Slow queries (requires pg_stat_statements)
SELECT 
    query,
    calls,
    mean_exec_time,
    max_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## Next Steps

1. **Apply the schema** to your database
2. **Create seed data** for development
3. **Set up migrations** tracking system
4. **Implement backup** strategy
5. **Add monitoring** and alerts
6. **Review security** settings (RLS, encryption)

## Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Database Design Best Practices](https://www.postgresql.org/docs/current/ddl.html)
- [pgcrypto for Encryption](https://www.postgresql.org/docs/current/pgcrypto.html)
- [Row-Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

## Questions?

This schema is production-ready but should be customized for your specific needs!
