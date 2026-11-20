-- 0014 Background jobs that are safe with several app servers
--
-- job_runs: each scheduled job claims its slot (e.g. "reminders" for 2026-11-20)
-- before running. A second server finds the slot taken and does nothing, so
-- reminders and recurring invoices are never produced twice. Failed runs can be
-- retried; every run's outcome is kept for troubleshooting.
CREATE TABLE IF NOT EXISTS job_runs (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    run_key VARCHAR(50) NOT NULL,          -- the period this run covers, e.g. 2026-11-20 or 2026-W47
    status VARCHAR(10) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'DONE', 'FAILED')),
    result JSONB,
    error TEXT,
    host VARCHAR(255),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_runs_slot ON job_runs(name, run_key) WHERE status <> 'FAILED';
CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs(started_at DESC);

-- import_jobs: progress and results of background imports, readable from any server
CREATE TABLE IF NOT EXISTS import_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dry_run BOOLEAN NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'DONE', 'FAILED')),
    done INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    report JSONB,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_jobs_running ON import_jobs(company_id) WHERE status = 'RUNNING';
