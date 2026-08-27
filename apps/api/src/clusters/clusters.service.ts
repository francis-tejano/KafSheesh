import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  ClusterConfig,
  ClusterSummary,
  ConnectionDiagnostic,
  CreateClusterInput,
  SavedSearch,
  UpdateClusterInput,
} from '@kafsheesh/shared';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { open, seal } from '../common/crypto';
import { KafkaManagerService } from '../kafka/kafka-manager.service';
import { JsonStoreService } from '../store/json-store.service';

function redact(cluster: ClusterConfig): ClusterConfig {
  const copy: ClusterConfig = structuredClone(cluster);
  if (copy.tunnel?.password) {
    copy.tunnel.password = '••••';
  }
  if (copy.tunnel?.privateKey) {
    copy.tunnel.privateKey = '••••';
  }
  if (copy.tunnel?.passphrase) {
    copy.tunnel.passphrase = '••••';
  }
  for (const hop of copy.tunnel?.hops ?? []) {
    if (hop.password) {
      hop.password = '••••';
    }
    if (hop.privateKey) {
      hop.privateKey = '••••';
    }
    if (hop.passphrase) {
      hop.passphrase = '••••';
    }
  }
  if (copy.sasl?.password) {
    copy.sasl.password = '••••';
  }
  if (copy.schemaRegistry?.password) {
    copy.schemaRegistry.password = '••••';
  }
  return copy;
}

function applySecrets(target: ClusterConfig, incoming: UpdateClusterInput) {
  if (incoming.tunnel) {
    if (incoming.tunnel.password === '••••') {
      incoming.tunnel.password = target.tunnel?.password;
    }
    if (incoming.tunnel.privateKey === '••••') {
      incoming.tunnel.privateKey = target.tunnel?.privateKey;
    }
    if (incoming.tunnel.passphrase === '••••') {
      incoming.tunnel.passphrase = target.tunnel?.passphrase;
    }
    incoming.tunnel.hops = incoming.tunnel.hops?.map((hop, index) => {
      const stored = target.tunnel?.hops?.[index];
      if (hop.password === '••••') {
        hop.password = stored?.password;
      }
      if (hop.privateKey === '••••') {
        hop.privateKey = stored?.privateKey;
      }
      if (hop.passphrase === '••••') {
        hop.passphrase = stored?.passphrase;
      }
      return hop;
    });
  }
  if (incoming.sasl?.password === '••••') {
    incoming.sasl.password = target.sasl?.password ?? incoming.sasl.password;
  }
  if (incoming.schemaRegistry?.password === '••••') {
    incoming.schemaRegistry.password = target.schemaRegistry?.password;
  }
}

function encryptCluster(cluster: ClusterConfig): ClusterConfig {
  const next = structuredClone(cluster);
  if (next.tunnel) {
    next.tunnel.password = seal(next.tunnel.password);
    next.tunnel.privateKey = seal(next.tunnel.privateKey);
    next.tunnel.passphrase = seal(next.tunnel.passphrase);
    next.tunnel.hops = next.tunnel.hops?.map((hop) => ({
      ...hop,
      password: seal(hop.password),
      privateKey: seal(hop.privateKey),
      passphrase: seal(hop.passphrase),
    }));
  }
  if (next.sasl) {
    next.sasl.password = seal(next.sasl.password) ?? next.sasl.password;
  }
  if (next.schemaRegistry) {
    next.schemaRegistry.password = seal(next.schemaRegistry.password);
  }
  return next;
}

function decryptCluster(cluster: ClusterConfig): ClusterConfig {
  const next = structuredClone(cluster);
  if (next.tunnel) {
    next.tunnel.password = open(next.tunnel.password);
    next.tunnel.privateKey = open(next.tunnel.privateKey);
    next.tunnel.passphrase = open(next.tunnel.passphrase);
    next.tunnel.hops = next.tunnel.hops?.map((hop) => ({
      ...hop,
      password: open(hop.password),
      privateKey: open(hop.privateKey),
      passphrase: open(hop.passphrase),
    }));
  }
  if (next.sasl) {
    next.sasl.password = open(next.sasl.password) ?? next.sasl.password;
  }
  if (next.schemaRegistry) {
    next.schemaRegistry.password = open(next.schemaRegistry.password);
  }
  return next;
}

@Injectable()
export class ClustersService {
  private readonly logger = new Logger(ClustersService.name);

  constructor(
    private readonly store: JsonStoreService,
    private readonly kafka: KafkaManagerService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
  ) {}

  async list(): Promise<ClusterSummary[]> {
    const clusters = await this.readAll();
    return clusters.map((cluster) => {
      this.kafka.rememberName(cluster.id, cluster.name);
      return {
        ...redact(cluster),
        runtime: this.kafka.runtime(cluster.id),
      };
    });
  }

  async get(id: string): Promise<ClusterSummary> {
    const cluster = await this.find(id);
    this.kafka.rememberName(cluster.id, cluster.name);
    return { ...redact(cluster), runtime: this.kafka.runtime(id) };
  }

  async create(input: CreateClusterInput): Promise<ClusterSummary> {
    const clusters = await this.readAll();
    const now = new Date().toISOString();
    const cluster: ClusterConfig = encryptCluster({
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    clusters.push(cluster);
    await this.store.write('clusters.json', clusters);
    await this.audit.record({
      action: 'cluster.create',
      clusterId: cluster.id,
      clusterName: cluster.name,
      ok: true,
    });
    return this.get(cluster.id);
  }

  async update(id: string, input: UpdateClusterInput): Promise<ClusterSummary> {
    const clusters = await this.readAll();
    const index = clusters.findIndex((cluster) => cluster.id === id);
    if (index === -1) {
      throw new NotFoundException(`Cluster ${id} not found`);
    }
    applySecrets(clusters[index], input);
    clusters[index] = encryptCluster({
      ...clusters[index],
      ...input,
      id,
      createdAt: clusters[index].createdAt,
      updatedAt: new Date().toISOString(),
    });
    await this.store.write('clusters.json', clusters);
    await this.audit.record({
      action: 'cluster.update',
      clusterId: id,
      clusterName: clusters[index].name,
      ok: true,
    });
    return this.get(id);
  }

  async duplicate(id: string): Promise<ClusterSummary> {
    const source = await this.find(id);
    const clusters = await this.readAll();
    const now = new Date().toISOString();
    const copy: ClusterConfig = structuredClone(source);
    copy.id = randomUUID();
    copy.name = this.copyName(source.name, clusters.map((cluster) => cluster.name));
    copy.createdAt = now;
    copy.updatedAt = now;
    clusters.push(copy);
    await this.store.write('clusters.json', clusters);
    this.kafka.rememberName(copy.id, copy.name);
    await this.audit.record({
      action: 'cluster.duplicate',
      clusterId: copy.id,
      clusterName: copy.name,
      target: source.name,
      ok: true,
    });
    return this.get(copy.id);
  }

  async remove(id: string): Promise<void> {
    const cluster = await this.find(id);
    await this.kafka.disconnect(id);
    const clusters = (await this.readAll()).filter((item) => item.id !== id);
    await this.store.write('clusters.json', clusters);
    await this.audit.record({
      action: 'cluster.delete',
      clusterId: id,
      clusterName: cluster.name,
      ok: true,
    });
  }

  async connect(id: string) {
    const cluster = decryptCluster(await this.find(id));
    this.logger.log(`Connect requested for "${cluster.name}" (${id})`);
    this.logger.log(this.describeConnection(cluster));
    this.activity.info('Connect', `Connecting "${cluster.name}"`, id);
    for (const line of this.describeConnection(cluster).split('\n')) {
      this.activity.info('Connect', line.trim(), id);
    }
    try {
      const runtime = await this.kafka.connect(cluster);
      const summary =
        `Connect ok "${cluster.name}" status=${runtime.status}` +
        (runtime.tunnel
          ? ` tunnel=${runtime.tunnel.bastion} forwards=${runtime.tunnel.forwards.length}`
          : ' path=direct');
      this.logger.log(summary);
      this.activity.info('Connect', summary, id);
      await this.audit.record({
        action: 'cluster.connect',
        clusterId: id,
        clusterName: cluster.name,
        ok: true,
        detail: runtime.tunnel?.connected ? 'via tunnel' : 'direct',
      });
      return runtime;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`Connect failed "${cluster.name}": ${detail}`);
      this.activity.error('Connect', `Connect failed "${cluster.name}": ${detail}`, id);
      await this.audit.record({
        action: 'cluster.connect',
        clusterId: id,
        clusterName: cluster.name,
        ok: false,
        detail,
      });
      throw error;
    }
  }

  async disconnect(id: string) {
    const cluster = await this.find(id);
    await this.kafka.disconnect(id);
    await this.audit.record({
      action: 'cluster.disconnect',
      clusterId: id,
      clusterName: cluster.name,
      ok: true,
    });
    return this.kafka.runtime(id);
  }

  async diagnose(id: string): Promise<ConnectionDiagnostic> {
    const cluster = decryptCluster(await this.find(id));
    const result = await this.kafka.diagnose(cluster);
    await this.audit.record({
      action: 'cluster.diagnose',
      clusterId: id,
      clusterName: cluster.name,
      ok: result.ok,
      detail: result.steps.map((step) => `${step.id}:${step.status}`).join(', '),
    });
    return result;
  }

  async savedSearches(clusterId: string): Promise<SavedSearch[]> {
    await this.find(clusterId);
    const searches = await this.store.read<SavedSearch[]>('searches.json', []);
    return searches.filter((search) => search.clusterId === clusterId);
  }

  async saveSearch(
    clusterId: string,
    input: { name: string; topic: string; q?: string; jsonPath?: string },
  ): Promise<SavedSearch> {
    await this.find(clusterId);
    const searches = await this.store.read<SavedSearch[]>('searches.json', []);
    const search: SavedSearch = {
      id: randomUUID(),
      clusterId,
      createdAt: new Date().toISOString(),
      ...input,
    };
    searches.push(search);
    await this.store.write('searches.json', searches);
    return search;
  }

  async deleteSearch(clusterId: string, searchId: string): Promise<void> {
    const searches = await this.store.read<SavedSearch[]>('searches.json', []);
    await this.store.write(
      'searches.json',
      searches.filter((search) => !(search.clusterId === clusterId && search.id === searchId)),
    );
  }

  private describeConnection(cluster: ClusterConfig): string {
    const lines = [
      `  brokers: ${cluster.brokers.join(', ') || '(none)'}`,
      `  tls: ${cluster.ssl ? 'yes' : 'no'}`,
      `  sasl: ${cluster.sasl ? cluster.sasl.mechanism : 'none'}`,
    ];
    if (cluster.tunnel?.enabled) {
      const tunnel = cluster.tunnel;
      lines.push(
        `  path: tunnel ${tunnel.username}@${tunnel.host}:${tunnel.port}`,
        `  sshAuth: ${tunnel.authType}` +
          (tunnel.authType === 'privateKey'
            ? ` file=${tunnel.privateKeyFileName ?? 'pasted/stored'} key=${tunnel.privateKey ? 'yes' : 'MISSING'} passphrase=${tunnel.passphrase ? 'yes' : 'no'}`
            : ` password=${tunnel.password ? 'yes' : 'MISSING'}`),
        `  remoteBrokers: ${(tunnel.remoteBrokers ?? cluster.brokers).join(', ')}`,
      );
      for (const [index, hop] of (tunnel.hops ?? []).entries()) {
        lines.push(
          `  hop[${index}]: ${hop.username}@${hop.host}:${hop.port} auth=${hop.authType}` +
            (hop.privateKeyFileName ? ` file=${hop.privateKeyFileName}` : ''),
        );
      }
    } else {
      lines.push('  path: direct');
    }
    return lines.join('\n');
  }

  private copyName(name: string, taken: string[]): string {
    const root = name.replace(/ \(copy(?: \d+)?\)$/i, '');
    const used = new Set(taken);
    let candidate = `${root} (copy)`;
    let index = 2;
    while (used.has(candidate)) {
      candidate = `${root} (copy ${index})`;
      index += 1;
    }
    return candidate;
  }

  private async readAll(): Promise<ClusterConfig[]> {
    return this.store.read<ClusterConfig[]>('clusters.json', []);
  }

  private async find(id: string): Promise<ClusterConfig> {
    const cluster = (await this.readAll()).find((item) => item.id === id);
    if (!cluster) {
      throw new NotFoundException(`Cluster ${id} not found`);
    }
    return cluster;
  }
}
