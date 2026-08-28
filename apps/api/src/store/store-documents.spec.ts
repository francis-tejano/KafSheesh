import type { ClusterConfig, SavedSearch } from '@kafsheesh/shared';
import { clusterRow, searchFromRow, searchRow } from './store-documents';

describe('store-documents', () => {
  it('round-trips a cluster document', () => {
    const cluster: ClusterConfig = {
      id: 'c1',
      name: 'SIT',
      brokers: ['kf.example:9092'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    const row = clusterRow(cluster);
    expect(row.id).toBe('c1');
    expect(row.document).toEqual(cluster);
  });

  it('round-trips a saved search', () => {
    const search: SavedSearch = {
      id: 's1',
      clusterId: 'c1',
      name: 'errors',
      topic: 'ttsm.AuditRequests',
      q: 'timeout',
      jsonPath: 'user.id',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const row = searchRow(search);
    expect(
      searchFromRow({
        id: row.id,
        cluster_id: row.clusterId,
        name: row.name,
        topic: row.topic,
        q: row.q,
        json_path: row.jsonPath,
        created_at: row.createdAt,
      }),
    ).toEqual(search);
  });
});
