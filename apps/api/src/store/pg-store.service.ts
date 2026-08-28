import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { AuditEvent, ClusterConfig, SavedSearch } from '@kafsheesh/shared';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Pool, type PoolClient } from 'pg';
import { bindDnsCacheStore } from '../tunnel/resolve-host';
import { AppStore, databaseUrl } from './app-store';
import { POSTGRES_SCHEMA } from './schema';
import {
  AUDIT_FILE,
  CLUSTER_FILE,
  DNS_FILE,
  SEARCH_FILE,
  auditFromRow,
  clusterRow,
  emptyDnsCache,
  searchFromRow,
  searchRow,
  type DnsCacheDocument,
} from './store-documents';

@Injectable()
export class PgStoreService
  extends AppStore
  implements OnModuleInit, OnModuleDestroy
{
  readonly kind = 'postgres' as const;
  private readonly logger = new Logger(PgStoreService.name);
  private readonly pool: Pool;

  constructor() {
    super();
    const url = databaseUrl();
    if (!url) {
      throw new Error('DATABASE_URL is required for Postgres store');
    }
    this.pool = new Pool({ connectionString: url });
  }

  async onModuleInit() {
    await this.pool.query(POSTGRES_SCHEMA);
    await this.importJsonIfEmpty();
    bindDnsCacheStore(this);
    this.logger.log('Postgres store ready');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async read<T>(name: string, fallback: T): Promise<T> {
    if (name === CLUSTER_FILE) {
      const result = await this.pool.query<{ document: ClusterConfig }>(
        'SELECT document FROM clusters ORDER BY name',
      );
      return (result.rows.map((row) => row.document) as T) ?? fallback;
    }
    if (name === SEARCH_FILE) {
      const result = await this.pool.query<{
        id: string;
        cluster_id: string;
        name: string;
        topic: string;
        q: string | null;
        json_path: string | null;
        created_at: Date;
      }>(
        'SELECT id, cluster_id, name, topic, q, json_path, created_at FROM saved_searches ORDER BY created_at',
      );
      return result.rows.map((row) => searchFromRow(row)) as T;
    }
    if (name === AUDIT_FILE) {
      const result = await this.pool.query<{
        id: string;
        at: Date;
        action: AuditEvent['action'];
        cluster_id: string | null;
        cluster_name: string | null;
        target: string | null;
        detail: string | null;
        ok: boolean;
      }>(
        'SELECT id, at, action, cluster_id, cluster_name, target, detail, ok FROM audit_events ORDER BY at',
      );
      return result.rows.map((row) => auditFromRow(row)) as T;
    }
    const result = await this.pool.query<{ document: T }>(
      'SELECT document FROM kv_documents WHERE name = $1',
      [name],
    );
    return result.rows[0]?.document ?? fallback;
  }

  async write<T>(name: string, value: T): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (name === CLUSTER_FILE) {
        await this.replaceClusters(client, value as ClusterConfig[]);
      } else if (name === SEARCH_FILE) {
        await this.replaceSearches(client, value as SavedSearch[]);
      } else if (name === AUDIT_FILE) {
        await this.replaceAudit(client, value as AuditEvent[]);
      } else {
        await client.query(
          `INSERT INTO kv_documents (name, document, updated_at)
           VALUES ($1, $2::jsonb, now())
           ON CONFLICT (name) DO UPDATE SET document = EXCLUDED.document, updated_at = now()`,
          [name, JSON.stringify(value)],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async replaceClusters(client: PoolClient, clusters: ClusterConfig[]) {
    const ids = clusters.map((cluster) => cluster.id);
    if (ids.length) {
      await client.query(
        'DELETE FROM clusters WHERE NOT (id = ANY($1::text[]))',
        [ids],
      );
    } else {
      await client.query('DELETE FROM clusters');
    }
    for (const cluster of clusters) {
      const row = clusterRow(cluster);
      await client.query(
        `INSERT INTO clusters (id, name, document, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           document = EXCLUDED.document,
           updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.name,
          JSON.stringify(row.document),
          row.createdAt,
          row.updatedAt,
        ],
      );
    }
  }

  private async replaceSearches(client: PoolClient, searches: SavedSearch[]) {
    const ids = searches.map((search) => search.id);
    if (ids.length) {
      await client.query(
        'DELETE FROM saved_searches WHERE NOT (id = ANY($1::text[]))',
        [ids],
      );
    } else {
      await client.query('DELETE FROM saved_searches');
    }
    for (const search of searches) {
      const row = searchRow(search);
      await client.query(
        `INSERT INTO saved_searches (id, cluster_id, name, topic, q, json_path, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           cluster_id = EXCLUDED.cluster_id,
           name = EXCLUDED.name,
           topic = EXCLUDED.topic,
           q = EXCLUDED.q,
           json_path = EXCLUDED.json_path`,
        [
          row.id,
          row.clusterId,
          row.name,
          row.topic,
          row.q,
          row.jsonPath,
          row.createdAt,
        ],
      );
    }
  }

  private async replaceAudit(client: PoolClient, events: AuditEvent[]) {
    const kept = events.slice(-2000);
    const ids = kept.map((event) => event.id);
    if (ids.length) {
      await client.query(
        'DELETE FROM audit_events WHERE NOT (id = ANY($1::text[]))',
        [ids],
      );
    } else {
      await client.query('DELETE FROM audit_events');
    }
    for (const event of kept) {
      await client.query(
        `INSERT INTO audit_events (id, at, action, cluster_id, cluster_name, target, detail, ok)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          event.id,
          event.at,
          event.action,
          event.clusterId ?? null,
          event.clusterName ?? null,
          event.target ?? null,
          event.detail ?? null,
          event.ok,
        ],
      );
    }
  }

  private async importJsonIfEmpty() {
    const count = await this.pool.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM clusters',
    );
    if (count.rows[0]?.n) {
      return;
    }
    const root = process.env.KAFSHEESH_DATA_DIR ?? join(process.cwd(), 'data');
    const clusters = await readJsonFile<ClusterConfig[]>(
      join(root, CLUSTER_FILE),
      [],
    );
    const searches = await readJsonFile<SavedSearch[]>(
      join(root, SEARCH_FILE),
      [],
    );
    const audit = await readJsonFile<AuditEvent[]>(join(root, AUDIT_FILE), []);
    const dns = await readJsonFile<DnsCacheDocument>(
      join(root, DNS_FILE),
      emptyDnsCache(),
    );
    if (!clusters.length && !searches.length && !audit.length) {
      return;
    }
    this.logger.log(
      `Importing JSON store from ${root} (${clusters.length} clusters, ${searches.length} searches, ${audit.length} audit events)`,
    );
    await this.write(CLUSTER_FILE, clusters);
    await this.write(SEARCH_FILE, searches);
    await this.write(AUDIT_FILE, audit);
    await this.write(DNS_FILE, dns);
  }
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
