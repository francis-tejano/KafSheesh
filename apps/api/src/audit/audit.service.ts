import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuditAction, AuditEvent } from '@kafsheesh/shared';
import { JsonStoreService } from '../store/json-store.service';

@Injectable()
export class AuditService {
  constructor(private readonly store: JsonStoreService) {}

  async list(clusterId?: string): Promise<AuditEvent[]> {
    const events = await this.store.read<AuditEvent[]>('audit.json', []);
    const filtered = clusterId
      ? events.filter((event) => event.clusterId === clusterId)
      : events;
    return filtered.slice(-500).reverse();
  }

  async record(input: {
    action: AuditAction;
    clusterId?: string;
    clusterName?: string;
    target?: string;
    detail?: string;
    ok: boolean;
  }): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      ...input,
    };
    const events = await this.store.read<AuditEvent[]>('audit.json', []);
    events.push(event);
    await this.store.write('audit.json', events.slice(-2000));
    return event;
  }
}
