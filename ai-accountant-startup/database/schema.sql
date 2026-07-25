-- =================================================================
-- AccountantAI Database Schema
-- PostgreSQL 14+
-- 
-- This schema supports:
-- - Multi-tenant architecture (accounting firms with multiple clients)
-- - Double-entry bookkeeping
-- - Multi-currency transactions
-- - Document management (receipts, invoices)
-- - AI training and feedback loops
-- - Audit trails and compliance
-- =================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =================================================================
-- USERS & AUTHENTICATION
-- =================================================================

-- User roles and permissions
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Core user table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,  -- bcrypt hashed
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    role_id INTEGER REFERENCES roles(id),
    firm_id UUID,  -- NULL for solo practitioners
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    verification_token VARCHAR(255),
    reset_password_token VARCHAR(255),
    reset_password_expires TIMESTAMP WITH TIME ZONE,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Accounting firms (multi-user organizations)
CREATE TABLE firms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(50),  -- EIN or similar
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    country VARCHAR(2) DEFAULT 'US',  -- ISO country code
    phone VARCHAR(20),
    website VARCHAR(255),
    logo_url VARCHAR(500),
    subscription_tier VARCHAR(50) DEFAULT 'free',  -- free, pro, firm, enterprise
    subscription_status VARCHAR(50) DEFAULT 'trial',  -- trial, active, past_due, canceled
    subscription_expires TIMESTAMP WITH TIME ZONE,
    stripe_customer_id VARCHAR(255),
    settings JSONB DEFAULT '{}',  -- firm-wide settings
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add foreign key after firms table exists
ALTER TABLE users ADD CONSTRAINT fk_users_firm 
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE SET NULL;

-- Session management
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =================================================================
-- CLIENTS & BUSINESSES
-- =================================================================

-- Client businesses (accountant's customers)
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID REFERENCES firms(id) ON DELETE CASCADE,  -- NULL for solo users
    user_id UUID REFERENCES users(id),  -- Assigned accountant
    business_name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255),
    tax_id VARCHAR(50),  -- EIN/SSN (encrypted in practice)
    entity_type VARCHAR(50),  -- sole_prop, llc, s_corp, c_corp, partnership, nonprofit
    industry VARCHAR(100),
    fiscal_year_end DATE,  -- e.g., 12-31 for calendar year
    
    -- Contact information
    email VARCHAR(255),
    phone VARCHAR(20),
    website VARCHAR(255),
    
    -- Address
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    country VARCHAR(2) DEFAULT 'US',
    
    -- Status
    status VARCHAR(50) DEFAULT 'active',  -- active, inactive, archived
    
    -- Settings
    default_currency VARCHAR(3) DEFAULT 'USD',
    timezone VARCHAR(50) DEFAULT 'America/New_York',
    settings JSONB DEFAULT '{}',  -- client-specific settings
    
    -- Metadata
    notes TEXT,
    tags TEXT[],  -- For categorization/filtering
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =================================================================
-- CHART OF ACCOUNTS
-- =================================================================

-- Standard account types (based on accounting principles)
CREATE TABLE account_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,  -- Asset, Liability, Equity, Revenue, Expense
    normal_balance VARCHAR(10) NOT NULL,  -- DEBIT or CREDIT
    display_order INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Account categories (sub-types)
CREATE TABLE account_categories (
    id SERIAL PRIMARY KEY,
    account_type_id INTEGER REFERENCES account_types(id),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    display_order INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chart of accounts (per client)
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    account_number VARCHAR(20),  -- e.g., 1000, 2000, 3000
    name VARCHAR(255) NOT NULL,
    description TEXT,
    account_type_id INTEGER REFERENCES account_types(id),
    account_category_id INTEGER REFERENCES account_categories(id),
    parent_account_id UUID REFERENCES accounts(id),  -- For sub-accounts
    
    -- Properties
    is_active BOOLEAN DEFAULT true,
    is_bank_account BOOLEAN DEFAULT false,
    is_tax_account BOOLEAN DEFAULT false,
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- Balance tracking (denormalized for performance)
    current_balance DECIMAL(15,2) DEFAULT 0,
    last_reconciled_date DATE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(client_id, account_number)
);

-- =================================================================
-- TRANSACTIONS & JOURNAL ENTRIES
-- =================================================================

-- Transaction header (journal entry)
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    transaction_number VARCHAR(50),  -- Sequential number for client
    
    -- Transaction details
    transaction_date DATE NOT NULL,
    posting_date DATE,  -- When it hits the books (may differ from transaction_date)
    description TEXT,
    reference VARCHAR(100),  -- Check number, invoice number, etc.
    
    -- Type and status
    transaction_type VARCHAR(50),  -- journal_entry, payment, invoice, receipt, adjustment
    status VARCHAR(50) DEFAULT 'pending',  -- pending, posted, void, reconciled
    
    -- Source tracking
    source VARCHAR(50),  -- manual, bank_sync, receipt_scan, import, api
    source_id VARCHAR(255),  -- External ID from source system
    
    -- Document attachment
    document_id UUID,  -- Reference to documents table
    
    -- Reconciliation
    is_reconciled BOOLEAN DEFAULT false,
    reconciled_at TIMESTAMP WITH TIME ZONE,
    reconciled_by UUID REFERENCES users(id),
    
    -- AI metadata
    ai_confidence_score DECIMAL(3,2),  -- 0.00 to 1.00
    ai_suggested_category VARCHAR(100),
    ai_needs_review BOOLEAN DEFAULT false,
    
    -- Multi-currency support
    currency VARCHAR(3) DEFAULT 'USD',
    exchange_rate DECIMAL(10,6) DEFAULT 1.0,
    
    -- Audit trail
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(client_id, transaction_number)
);

-- Transaction lines (double-entry bookkeeping)
CREATE TABLE transaction_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id),
    
    -- Amount
    debit_amount DECIMAL(15,2) DEFAULT 0,
    credit_amount DECIMAL(15,2) DEFAULT 0,
    
    -- Multi-currency
    currency VARCHAR(3) DEFAULT 'USD',
    exchange_rate DECIMAL(10,6) DEFAULT 1.0,
    debit_amount_home DECIMAL(15,2) DEFAULT 0,  -- In home currency
    credit_amount_home DECIMAL(15,2) DEFAULT 0,
    
    -- Additional details
    description TEXT,
    memo TEXT,
    
    -- Tracking dimensions (for advanced reporting)
    department VARCHAR(100),
    project VARCHAR(100),
    location VARCHAR(100),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraint: Either debit or credit, not both
    CONSTRAINT check_debit_or_credit CHECK (
        (debit_amount > 0 AND credit_amount = 0) OR 
        (credit_amount > 0 AND debit_amount = 0)
    )
);

-- =================================================================
-- BANK CONNECTIONS & RECONCILIATION
-- =================================================================

-- Connected bank accounts (via Plaid or similar)
CREATE TABLE bank_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id),  -- Link to chart of accounts
    
    -- Bank details
    institution_name VARCHAR(255),
    institution_id VARCHAR(100),  -- Plaid institution_id
    account_name VARCHAR(255),
    account_mask VARCHAR(10),  -- Last 4 digits
    account_type VARCHAR(50),  -- checking, savings, credit_card
    account_subtype VARCHAR(50),
    
    -- Connection details
    access_token TEXT,  -- Encrypted in practice
    plaid_account_id VARCHAR(255),
    plaid_item_id VARCHAR(255),
    
    -- Sync status
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    next_sync_at TIMESTAMP WITH TIME ZONE,
    sync_status VARCHAR(50) DEFAULT 'pending',  -- pending, syncing, success, error
    sync_error TEXT,
    
    -- Balance tracking
    current_balance DECIMAL(15,2),
    available_balance DECIMAL(15,2),
    balance_as_of TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bank transactions (imported from bank)
CREATE TABLE bank_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES transactions(id),  -- Link to accounting transaction
    
    -- Bank transaction details
    bank_transaction_id VARCHAR(255) UNIQUE,  -- From Plaid
    transaction_date DATE NOT NULL,
    posted_date DATE,
    amount DECIMAL(15,2) NOT NULL,
    description TEXT,
    merchant_name VARCHAR(255),
    category TEXT[],  -- Plaid categories
    
    -- Matching status
    is_matched BOOLEAN DEFAULT false,
    matched_at TIMESTAMP WITH TIME ZONE,
    matched_by UUID REFERENCES users(id),
    match_confidence DECIMAL(3,2),  -- AI confidence in match
    
    -- AI categorization
    suggested_account_id UUID REFERENCES accounts(id),
    suggested_category VARCHAR(100),
    ai_confidence_score DECIMAL(3,2),
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending',  -- pending, categorized, matched, ignored
    is_duplicate BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =================================================================
-- DOCUMENTS & RECEIPTS
-- =================================================================

-- Document storage (receipts, invoices, contracts, etc.)
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES users(id),
    
    -- File details
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT,  -- In bytes
    file_type VARCHAR(50),  -- image/jpeg, application/pdf, etc.
    file_url VARCHAR(500) NOT NULL,  -- S3 URL or similar
    thumbnail_url VARCHAR(500),
    
    -- Document metadata
    document_type VARCHAR(50),  -- receipt, invoice, contract, tax_form, other
    document_date DATE,
    description TEXT,
    tags TEXT[],
    
    -- OCR and extraction
    ocr_text TEXT,  -- Full extracted text
    extracted_data JSONB,  -- Structured data (vendor, amount, date, etc.)
    ocr_confidence_score DECIMAL(3,2),
    
    -- Processing status
    processing_status VARCHAR(50) DEFAULT 'pending',  -- pending, processing, completed, failed
    processing_error TEXT,
    processed_at TIMESTAMP WITH TIME ZONE,
    
    -- Transaction linkage
    transaction_id UUID REFERENCES transactions(id),
    is_processed BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Extracted entities from documents (for ML training)
CREATE TABLE document_entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    
    -- Entity details
    entity_type VARCHAR(50) NOT NULL,  -- vendor, amount, date, category, tax_deduction
    entity_value TEXT NOT NULL,
    confidence_score DECIMAL(3,2),
    
    -- Bounding box (for visual highlighting)
    bbox_x INTEGER,
    bbox_y INTEGER,
    bbox_width INTEGER,
    bbox_height INTEGER,
    
    -- User feedback (for model improvement)
    is_correct BOOLEAN,
    corrected_value TEXT,
    feedback_by UUID REFERENCES users(id),
    feedback_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =================================================================
-- TAX MANAGEMENT
-- =================================================================

-- Tax forms (1040, 1120, etc.)
CREATE TABLE tax_forms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    
    -- Form details
    tax_year INTEGER NOT NULL,
    form_type VARCHAR(50) NOT NULL,  -- 1040, 1120, 1120S, 1065, etc.
    form_name VARCHAR(255),
    filing_status VARCHAR(50),  -- single, married_filing_jointly, etc.
    
    -- Status
    status VARCHAR(50) DEFAULT 'draft',  -- draft, review, filed, accepted, rejected
    
    -- Form data (JSON structure matching IRS schemas)
    form_data JSONB,
    
    -- Filing details
    filed_date DATE,
    filing_method VARCHAR(50),  -- e_file, mail, irs_direct
    confirmation_number VARCHAR(100),
    
    -- Attachments
    pdf_url VARCHAR(500),
    supporting_docs TEXT[],  -- Array of document IDs
    
    -- Tax calculations
    total_income DECIMAL(15,2),
    total_deductions DECIMAL(15,2),
    taxable_income DECIMAL(15,2),
    total_tax DECIMAL(15,2),
    amount_owed DECIMAL(15,2),
    refund_amount DECIMAL(15,2),
    
    -- Audit trail
    prepared_by UUID REFERENCES users(id),
    reviewed_by UUID REFERENCES users(id),
    prepared_at TIMESTAMP WITH TIME ZONE,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tax deductions and credits tracker
CREATE TABLE tax_deductions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    tax_form_id UUID REFERENCES tax_forms(id),
    
    -- Deduction details
    deduction_type VARCHAR(100) NOT NULL,  -- home_office, mileage, meals, etc.
    deduction_category VARCHAR(50),  -- standard, itemized, business_expense
    description TEXT,
    
    -- Amount
    amount DECIMAL(15,2) NOT NULL,
    tax_year INTEGER NOT NULL,
    
    -- Supporting documentation
    document_ids UUID[],
    notes TEXT,
    
    -- AI suggestions
    is_ai_suggested BOOLEAN DEFAULT false,
    ai_confidence_score DECIMAL(3,2),
    is_approved BOOLEAN DEFAULT false,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Estimated tax payments tracker
CREATE TABLE estimated_tax_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    tax_year INTEGER NOT NULL,
    quarter INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
    
    -- Payment details
    amount_due DECIMAL(15,2),
    amount_paid DECIMAL(15,2),
    due_date DATE NOT NULL,
    payment_date DATE,
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending',  -- pending, paid, late, waived
    
    -- Payment method
    payment_method VARCHAR(50),  -- check, eftps, credit_card, etc.
    confirmation_number VARCHAR(100),
    
    -- Reminders
    reminder_sent BOOLEAN DEFAULT false,
    reminder_sent_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =================================================================
-- FINANCIAL REPORTS & FORECASTING
-- =================================================================

-- Saved reports and schedules
CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id),
    
    -- Report details
    report_name VARCHAR(255) NOT NULL,
    report_type VARCHAR(50) NOT NULL,  -- profit_loss, balance_sheet, cash_flow, custom
    
    -- Parameters
    start_date DATE,
    end_date DATE,
    comparison_period VARCHAR(50),  -- none, prior_period, prior_year, custom
    filters JSONB,  -- Custom filters (departments, projects, etc.)
    
    -- Report data (cached)
    report_data JSONB,
    
    -- Output
    pdf_url VARCHAR(500),
    excel_url VARCHAR(500),
    
    -- Scheduling
    is_scheduled BOOLEAN DEFAULT false,
    schedule_frequency VARCHAR(50),  -- weekly, monthly, quarterly, annually
    schedule_day INTEGER,  -- Day of week/month
    last_sent_at TIMESTAMP WITH TIME ZONE,
    
    -- Recipients
    recipients TEXT[],  -- Email addresses
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Cash flow forecasts
CREATE TABLE cash_flow_forecasts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    
    -- Forecast details
    forecast_date DATE NOT NULL,
    forecast_type VARCHAR(50),  -- daily, weekly, monthly
    days_ahead INTEGER,  -- 30, 60, 90
    
    -- Forecasted values
    opening_balance DECIMAL(15,2),
    forecasted_inflows DECIMAL(15,2),
    forecasted_outflows DECIMAL(15,2),
    forecasted_balance DECIMAL(15,2),
    
    -- Confidence and alerts
    confidence_score DECIMAL(3,2),
    has_alert BOOLEAN DEFAULT false,
    alert_type VARCHAR(50),  -- cash_crunch, negative_balance, low_runway
    alert_message TEXT,
    
    -- Actual values (for accuracy tracking)
    actual_balance DECIMAL(15,2),
    accuracy_score DECIMAL(3,2),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =================================================================
-- AI & MACHINE LEARNING
-- =================================================================

-- AI categorization training data
CREATE TABLE ai_training_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    
    -- Input features
    description TEXT NOT NULL,
    merchant_name VARCHAR(255),
    amount DECIMAL(15,2),
    transaction_type VARCHAR(50),
    
    -- Label (correct category)
    account_id UUID REFERENCES accounts(id),
    category_name VARCHAR(100),
    
    -- Feedback source
    feedback_type VARCHAR(50),  -- user_correction, user_confirmation, initial_entry
    feedback_by UUID REFERENCES users(id),
    feedback_at TIMESTAMP WITH TIME ZONE,
    
    -- Model performance tracking
    predicted_account_id UUID REFERENCES accounts(id),
    prediction_confidence DECIMAL(3,2),
    was_prediction_correct BOOLEAN,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- AI model versions and performance
CREATE TABLE ai_models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name VARCHAR(100) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    model_type VARCHAR(50),  -- classification, extraction, forecasting
    
    -- Model artifacts
    model_path VARCHAR(500),
    config JSONB,
    
    -- Performance metrics
    accuracy DECIMAL(5,4),
    precision_score DECIMAL(5,4),
    recall DECIMAL(5,4),
    f1_score DECIMAL(5,4),
    
    -- Training details
    training_samples INTEGER,
    training_duration INTEGER,  -- In seconds
    trained_at TIMESTAMP WITH TIME ZONE,
    
    -- Deployment
    is_active BOOLEAN DEFAULT false,
    deployed_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User AI interactions (for conversational AI)
CREATE TABLE ai_queries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    client_id UUID REFERENCES clients(id),
    
    -- Query details
    query_text TEXT NOT NULL,
    query_intent VARCHAR(100),  -- report_request, question, calculation, forecast
    
    -- Response
    response_text TEXT,
    response_data JSONB,  -- Structured data for charts, tables
    response_time_ms INTEGER,
    
    -- Context
    conversation_id UUID,  -- For multi-turn conversations
    session_id UUID,
    
    -- Feedback
    was_helpful BOOLEAN,
    feedback_text TEXT,
    feedback_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =================================================================
-- AUDIT TRAIL & COMPLIANCE
-- =================================================================

-- Comprehensive audit log
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    client_id UUID REFERENCES clients(id),
    
    -- Action details
    action VARCHAR(100) NOT NULL,  -- create, update, delete, view, export
    resource_type VARCHAR(100) NOT NULL,  -- transaction, account, document, etc.
    resource_id UUID,
    
    -- Changes (for update actions)
    old_values JSONB,
    new_values JSONB,
    
    -- Request metadata
    ip_address INET,
    user_agent TEXT,
    request_id UUID,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Data exports (for GDPR compliance)
CREATE TABLE data_exports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    client_id UUID REFERENCES clients(id),
    
    -- Export details
    export_type VARCHAR(50),  -- full_data, transactions, documents, reports
    date_range_start DATE,
    date_range_end DATE,
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending',  -- pending, processing, completed, failed
    
    -- Output
    file_url VARCHAR(500),
    file_size BIGINT,
    expires_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- =================================================================
-- NOTIFICATIONS & ALERTS
-- =================================================================

-- User notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    -- Notification details
    type VARCHAR(50) NOT NULL,  -- info, warning, error, success
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    
    -- Action
    action_url VARCHAR(500),
    action_text VARCHAR(100),
    
    -- Status
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMP WITH TIME ZONE,
    
    -- Delivery channels
    sent_email BOOLEAN DEFAULT false,
    sent_sms BOOLEAN DEFAULT false,
    sent_push BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =================================================================
-- INDEXES FOR PERFORMANCE
-- =================================================================

-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_firm_id ON users(firm_id);
CREATE INDEX idx_users_is_active ON users(is_active);

-- Sessions
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- Clients
CREATE INDEX idx_clients_firm_id ON clients(firm_id);
CREATE INDEX idx_clients_user_id ON clients(user_id);
CREATE INDEX idx_clients_status ON clients(status);

-- Accounts
CREATE INDEX idx_accounts_client_id ON accounts(client_id);
CREATE INDEX idx_accounts_account_type_id ON accounts(account_type_id);
CREATE INDEX idx_accounts_is_active ON accounts(is_active);

-- Transactions
CREATE INDEX idx_transactions_client_id ON transactions(client_id);
CREATE INDEX idx_transactions_transaction_date ON transactions(transaction_date);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_transaction_type ON transactions(transaction_type);
CREATE INDEX idx_transactions_document_id ON transactions(document_id);

-- Transaction lines
CREATE INDEX idx_transaction_lines_transaction_id ON transaction_lines(transaction_id);
CREATE INDEX idx_transaction_lines_account_id ON transaction_lines(account_id);

-- Bank accounts
CREATE INDEX idx_bank_accounts_client_id ON bank_accounts(client_id);
CREATE INDEX idx_bank_accounts_account_id ON bank_accounts(account_id);
CREATE INDEX idx_bank_accounts_is_active ON bank_accounts(is_active);

-- Bank transactions
CREATE INDEX idx_bank_transactions_bank_account_id ON bank_transactions(bank_account_id);
CREATE INDEX idx_bank_transactions_transaction_id ON bank_transactions(transaction_id);
CREATE INDEX idx_bank_transactions_transaction_date ON bank_transactions(transaction_date);
CREATE INDEX idx_bank_transactions_is_matched ON bank_transactions(is_matched);

-- Documents
CREATE INDEX idx_documents_client_id ON documents(client_id);
CREATE INDEX idx_documents_document_type ON documents(document_type);
CREATE INDEX idx_documents_transaction_id ON documents(transaction_id);
CREATE INDEX idx_documents_document_date ON documents(document_date);

-- Tax forms
CREATE INDEX idx_tax_forms_client_id ON tax_forms(client_id);
CREATE INDEX idx_tax_forms_tax_year ON tax_forms(tax_year);
CREATE INDEX idx_tax_forms_status ON tax_forms(status);

-- Reports
CREATE INDEX idx_reports_client_id ON reports(client_id);
CREATE INDEX idx_reports_report_type ON reports(report_type);

-- AI queries
CREATE INDEX idx_ai_queries_user_id ON ai_queries(user_id);
CREATE INDEX idx_ai_queries_client_id ON ai_queries(client_id);
CREATE INDEX idx_ai_queries_conversation_id ON ai_queries(conversation_id);

-- Audit log
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_client_id ON audit_log(client_id);
CREATE INDEX idx_audit_log_resource_type ON audit_log(resource_type);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

-- =================================================================
-- TRIGGERS FOR UPDATED_AT
-- =================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_firms_updated_at BEFORE UPDATE ON firms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bank_accounts_updated_at BEFORE UPDATE ON bank_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bank_transactions_updated_at BEFORE UPDATE ON bank_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tax_forms_updated_at BEFORE UPDATE ON tax_forms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================================================================
-- SEED DATA (Initial Setup)
-- =================================================================

-- Insert default roles
INSERT INTO roles (name, description) VALUES
    ('admin', 'Full system access'),
    ('accountant', 'Can manage clients and transactions'),
    ('bookkeeper', 'Can enter transactions and receipts'),
    ('client', 'View-only access to their own data'),
    ('auditor', 'Read-only access for compliance');

-- Insert account types
INSERT INTO account_types (name, normal_balance, display_order) VALUES
    ('Asset', 'DEBIT', 1),
    ('Liability', 'CREDIT', 2),
    ('Equity', 'CREDIT', 3),
    ('Revenue', 'CREDIT', 4),
    ('Expense', 'DEBIT', 5);

-- Insert account categories
INSERT INTO account_categories (account_type_id, name, display_order) VALUES
    -- Assets
    (1, 'Cash and Bank Accounts', 1),
    (1, 'Accounts Receivable', 2),
    (1, 'Inventory', 3),
    (1, 'Fixed Assets', 4),
    (1, 'Other Assets', 5),
    -- Liabilities
    (2, 'Accounts Payable', 1),
    (2, 'Credit Cards', 2),
    (2, 'Loans', 3),
    (2, 'Other Liabilities', 4),
    -- Equity
    (3, 'Owner Equity', 1),
    (3, 'Retained Earnings', 2),
    -- Revenue
    (4, 'Operating Revenue', 1),
    (4, 'Other Income', 2),
    -- Expenses
    (5, 'Cost of Goods Sold', 1),
    (5, 'Operating Expenses', 2),
    (5, 'Other Expenses', 3);

-- =================================================================
-- VIEWS FOR COMMON QUERIES
-- =================================================================

-- Account balances with current totals
CREATE VIEW account_balances AS
SELECT 
    a.id,
    a.client_id,
    a.account_number,
    a.name,
    at.name AS account_type,
    COALESCE(SUM(tl.debit_amount), 0) AS total_debits,
    COALESCE(SUM(tl.credit_amount), 0) AS total_credits,
    CASE 
        WHEN at.normal_balance = 'DEBIT' THEN 
            COALESCE(SUM(tl.debit_amount), 0) - COALESCE(SUM(tl.credit_amount), 0)
        ELSE 
            COALESCE(SUM(tl.credit_amount), 0) - COALESCE(SUM(tl.debit_amount), 0)
    END AS current_balance
FROM accounts a
JOIN account_types at ON a.account_type_id = at.id
LEFT JOIN transaction_lines tl ON a.id = tl.account_id
LEFT JOIN transactions t ON tl.transaction_id = t.id AND t.status = 'posted'
GROUP BY a.id, a.account_number, a.name, at.name, at.normal_balance;

-- Client dashboard summary
CREATE VIEW client_dashboard AS
SELECT 
    c.id AS client_id,
    c.business_name,
    COUNT(DISTINCT t.id) AS total_transactions,
    COUNT(DISTINCT d.id) AS total_documents,
    MAX(t.transaction_date) AS last_transaction_date,
    COUNT(DISTINCT CASE WHEN bt.is_matched = false THEN bt.id END) AS unmatched_bank_transactions,
    COUNT(DISTINCT CASE WHEN t.ai_needs_review = true THEN t.id END) AS transactions_need_review
FROM clients c
LEFT JOIN transactions t ON c.id = t.client_id
LEFT JOIN documents d ON c.id = d.client_id
LEFT JOIN bank_accounts ba ON c.id = ba.client_id
LEFT JOIN bank_transactions bt ON ba.id = bt.bank_account_id
WHERE c.status = 'active'
GROUP BY c.id, c.business_name;

-- =================================================================
-- END OF SCHEMA
-- =================================================================
