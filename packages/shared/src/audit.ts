export type AuditAction =
  | 'cluster.create'
  | 'cluster.update'
  | 'cluster.duplicate'
  | 'cluster.delete'
  | 'cluster.connect'
  | 'cluster.disconnect'
  | 'cluster.diagnose'
  | 'topic.create'
  | 'topic.delete'
  | 'message.produce'
  | 'group.reset-offsets'
  | 'group.delete'
  | 'schema.create'
  | 'schema.delete';

export interface AuditEvent {
  id: string;
  at: string;
  action: AuditAction;
  clusterId?: string;
  clusterName?: string;
  target?: string;
  detail?: string;
  ok: boolean;
}
