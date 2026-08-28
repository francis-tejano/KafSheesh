export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  document JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL,
  name TEXT NOT NULL,
  topic TEXT NOT NULL,
  q TEXT,
  json_path TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS saved_searches_cluster_idx
  ON saved_searches (cluster_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  action TEXT NOT NULL,
  cluster_id TEXT,
  cluster_name TEXT,
  target TEXT,
  detail TEXT,
  ok BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_at_idx
  ON audit_events (at DESC);

CREATE INDEX IF NOT EXISTS audit_events_cluster_idx
  ON audit_events (cluster_id);

CREATE TABLE IF NOT EXISTS kv_documents (
  name TEXT PRIMARY KEY,
  document JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
