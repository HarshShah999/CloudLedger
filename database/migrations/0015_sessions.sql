-- 0015 Login sessions with rotating refresh tokens
-- The browser holds a short-lived access token and a refresh token, both in
-- httpOnly cookies that page scripts cannot read. Only a SHA-256 hash of the
-- refresh token is stored. Each refresh replaces it; presenting an old one
-- again (after a short grace period for parallel tabs) means it was stolen,
-- and the session is revoked.
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL,
    prev_token_hash CHAR(64),
    rotated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_reason VARCHAR(50),
    user_agent VARCHAR(255),
    ip VARCHAR(64)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_prev_token ON sessions(prev_token_hash) WHERE prev_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id) WHERE revoked_at IS NULL;
