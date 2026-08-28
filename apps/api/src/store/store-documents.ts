import type { AuditEvent, ClusterConfig, SavedSearch } from '@kafsheesh/shared';

export const CLUSTER_FILE = 'clusters.json';
export const SEARCH_FILE = 'searches.json';
export const AUDIT_FILE = 'audit.json';
export const DNS_FILE = 'dns-cache.json';

export interface DnsCacheDocument {
  nameservers: string[];
  hosts: Record<string, { address: string; at: string }>;
}

export function emptyDnsCache(): DnsCacheDocument {
  return { nameservers: [], hosts: {} };
}

export function clusterRow(cluster: ClusterConfig): {
  id: string;
  name: string;
  document: ClusterConfig;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: cluster.id,
    name: cluster.name,
    document: cluster,
    createdAt: cluster.createdAt,
    updatedAt: cluster.updatedAt,
  };
}

export function searchRow(search: SavedSearch): {
  id: string;
  clusterId: string;
  name: string;
  topic: string;
  q: string | null;
  jsonPath: string | null;
  createdAt: string;
} {
  return {
    id: search.id,
    clusterId: search.clusterId,
    name: search.name,
    topic: search.topic,
    q: search.q ?? null,
    jsonPath: search.jsonPath ?? null,
    createdAt: search.createdAt,
  };
}

export function searchFromRow(row: {
  id: string;
  cluster_id: string;
  name: string;
  topic: string;
  q: string | null;
  json_path: string | null;
  created_at: Date | string;
}): SavedSearch {
  return {
    id: row.id,
    clusterId: row.cluster_id,
    name: row.name,
    topic: row.topic,
    q: row.q ?? undefined,
    jsonPath: row.json_path ?? undefined,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  };
}

export function auditFromRow(row: {
  id: string;
  at: Date | string;
  action: AuditEvent['action'];
  cluster_id: string | null;
  cluster_name: string | null;
  target: string | null;
  detail: string | null;
  ok: boolean;
}): AuditEvent {
  return {
    id: row.id,
    at: row.at instanceof Date ? row.at.toISOString() : row.at,
    action: row.action,
    clusterId: row.cluster_id ?? undefined,
    clusterName: row.cluster_name ?? undefined,
    target: row.target ?? undefined,
    detail: row.detail ?? undefined,
    ok: row.ok,
  };
}
