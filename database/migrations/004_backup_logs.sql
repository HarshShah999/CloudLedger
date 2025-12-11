-- Backup Logs Table
CREATE TABLE IF NOT EXISTS backup_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(20) NOT NULL, -- FULL, COMPANY
    filename VARCHAR(255),
    file_size BIGINT, -- bytes
    status VARCHAR(20) DEFAULT 'SUCCESS', -- SUCCESS, FAILED
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL, -- NULL for full backups
    error_message TEXT,
    storage_location VARCHAR(50) DEFAULT 'local', -- local, s3, gcs, azure
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Restore Logs Table
CREATE TABLE IF NOT EXISTS restore_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    backup_filename VARCHAR(255),
    type VARCHAR(20) NOT NULL, -- FULL, COMPANY
    status VARCHAR(20) DEFAULT 'SUCCESS', -- SUCCESS, FAILED
    restored_by UUID REFERENCES users(id) ON DELETE SET NULL,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_backup_logs_created ON backup_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_backup_logs_type ON backup_logs(type);
CREATE INDEX IF NOT EXISTS idx_backup_logs_status ON backup_logs(status);
CREATE INDEX IF NOT EXISTS idx_restore_logs_created ON restore_logs(created_at);
