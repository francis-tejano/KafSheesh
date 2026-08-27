import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { connect as netConnect, Socket } from 'net';
import { connect as tlsConnect } from 'tls';
import {
  Kafka,
  logLevel,
  type Admin,
  type Consumer,
  type KafkaConfig,
  type SASLOptions,
} from 'kafkajs';
import type {
  BrowseMessagesQuery,
  BrokerInfo,
  ClusterConfig,
  ClusterOverview,
  ClusterRuntime,
  ClusterStatus,
  ConnectionDiagnostic,
  ConsumerGroupInfo,
  CreateTopicInput,
  DiagnosticStep,
  KafkaMessage,
  ProduceMessageInput,
  ResetOffsetsInput,
  SchemaSubject,
  TopicDetail,
  TopicInfo,
  TunnelRuntime,
} from '@kafsheesh/shared';
import { ActivityService } from '../activity/activity.service';
import { open } from '../common/crypto';
import { SshTunnelService } from '../tunnel/ssh-tunnel.service';
import { browseStartOffset, browseWindowSize } from './browse-window';
import {
  brokerKey,
  isLoopbackHost,
  parseBroker,
  rewriteLoopbackBrokers,
} from './parse-broker';

interface LiveClient {
  config: ClusterConfig;
  kafka: Kafka;
  admin: Admin;
  status: ClusterStatus;
  lastError?: string;
  connectedAt?: string;
}

interface TopicSnapshot {
  at: number;
  topics: TopicInfo[];
  detail: Map<
    string,
    Pick<
      TopicDetail,
      'offsets' | 'consumerGroups' | 'consumerLag' | 'messageCount'
    >
  >;
}

const SNAPSHOT_TTL_MS = 45_000;

const INTERNAL_TOPIC =
  /^(__(consumer_offsets|transaction_state)|_confluent|_schemas)/;

@Injectable()
export class KafkaManagerService implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaManagerService.name);
  private readonly clients = new Map<string, LiveClient>();
  private readonly snapshots = new Map<string, TopicSnapshot>();
  private readonly names = new Map<string, string>();
  private readonly clusterOps = new Map<string, Promise<unknown>>();

  constructor(
    private readonly tunnels: SshTunnelService,
    private readonly activity: ActivityService,
  ) {}

  async onModuleDestroy() {
    await Promise.all(
      [...this.clients.keys()].map((id) => this.disconnect(id)),
    );
  }

  runtime(id: string): ClusterRuntime {
    const live = this.clients.get(id);
    const tunnel = this.tunnels.getRuntime(id);
    if (!live) {
      return { id, status: 'disconnected', tunnel };
    }
    return {
      id,
      status: live.status,
      lastError: live.lastError,
      connectedAt: live.connectedAt,
      tunnel,
    };
  }

  async connect(config: ClusterConfig): Promise<ClusterRuntime> {
    return this.enqueue(config.id, () => this.connectExclusive(config));
  }

  async disconnect(id: string): Promise<void> {
    await this.enqueue(id, () => this.disconnectExclusive(id));
  }

  private enqueue<T>(id: string, op: () => Promise<T>): Promise<T> {
    const previous = this.clusterOps.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(op);
    this.clusterOps.set(id, next);
    return next;
  }

  private async connectExclusive(
    config: ClusterConfig,
  ): Promise<ClusterRuntime> {
    const existing = this.clients.get(config.id);
    if (existing?.status === 'connected' && existing.admin) {
      this.logger.log(`Reusing open client for ${config.name} (${config.id})`);
      this.activity.info(
        'Kafka',
        `Already connected; keeping tunnel for ${config.name}`,
        config.id,
      );
      return this.runtime(config.id);
    }

    this.logger.log(`Opening Kafka client for ${config.name} (${config.id})`);
    this.activity.info('Kafka', `Opening client for ${config.name}`, config.id);
    await this.disconnectExclusive(config.id);
    try {
      const kafka = await this.buildClient(config);
      const admin = kafka.admin();
      this.logger.log(`Kafka admin.connect() for ${config.name}`);
      this.activity.info(
        'Kafka',
        `admin.connect() for ${config.name}`,
        config.id,
      );
      await admin.connect();
      this.clients.set(config.id, {
        config,
        kafka,
        admin,
        status: 'connected',
        connectedAt: new Date().toISOString(),
      });
      if (config.tunnel?.enabled) {
        this.tunnels.onLost(config.id, () => {
          const live = this.clients.get(config.id);
          if (live?.status === 'connected') {
            live.status = 'error';
            live.lastError = 'SSH tunnel closed';
            this.logger.warn(
              `Tunnel lost for ${config.name}; mark disconnected`,
            );
          }
        });
        await this.primeAdvertisedForwards(config.id, admin);
      }
      return this.runtime(config.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Kafka connect failed for ${config.name}: ${message}`);
      this.activity.error(
        'Kafka',
        `Connect failed for ${config.name}: ${message}`,
        config.id,
      );
      this.clients.set(config.id, {
        config,
        kafka: null as unknown as Kafka,
        admin: null as unknown as Admin,
        status: 'error',
        lastError: message,
      });
      throw error;
    }
  }

  private async disconnectExclusive(id: string): Promise<void> {
    const live = this.clients.get(id);
    if (live?.admin) {
      await live.admin.disconnect().catch(() => undefined);
    }
    await this.tunnels.closeSession(id);
    this.clients.delete(id);
    this.snapshots.delete(id);
  }

  async diagnose(config: ClusterConfig): Promise<ConnectionDiagnostic> {
    const steps: DiagnosticStep[] = [];
    const advertisedListeners: string[] = [];
    const remappedBrokers: string[] = [];
    let tunnel: TunnelRuntime | undefined;

    const run = async (
      id: string,
      label: string,
      fn: () => Promise<string | void>,
    ) => {
      const started = Date.now();
      steps.push({ id, label, status: 'running' });
      try {
        const detail = (await fn()) ?? 'ok';
        const step = steps.find((item) => item.id === id)!;
        step.status = 'ok';
        step.detail = typeof detail === 'string' ? detail : 'ok';
        step.durationMs = Date.now() - started;
      } catch (error) {
        const step = steps.find((item) => item.id === id)!;
        step.status = 'error';
        step.detail = error instanceof Error ? error.message : String(error);
        step.durationMs = Date.now() - started;
        throw error;
      }
    };

    try {
      if (config.tunnel?.enabled) {
        await run(
          'ssh',
          `SSH to ${config.tunnel.host}:${config.tunnel.port}`,
          async () => {
            tunnel = await this.tunnels.openSession(config.id, config.tunnel!);
            return `connected${tunnel.latencyMs ? ` (${tunnel.latencyMs}ms)` : ''}`;
          },
        );
        const remotes = config.tunnel.remoteBrokers?.length
          ? config.tunnel.remoteBrokers
          : config.brokers;
        await run(
          'forward',
          'Open local forwards to Kafka brokers',
          async () => {
            for (const broker of remotes) {
              const parsed = parseBroker(broker);
              const localPort = await this.tunnels.ensureForward(
                config.id,
                parsed.host,
                parsed.port,
              );
              remappedBrokers.push(`127.0.0.1:${localPort} → ${broker}`);
            }
            return remappedBrokers.join(', ');
          },
        );
      }

      await run('kafka', 'Fetch Kafka cluster metadata', async () => {
        const kafka = await this.buildClient(config, false);
        const admin = kafka.admin();
        await admin.connect();
        try {
          const cluster = await admin.describeCluster();
          for (const broker of cluster.brokers) {
            advertisedListeners.push(brokerKey(broker.host, broker.port));
            if (config.tunnel?.enabled) {
              const localPort = await this.tunnels.ensureForward(
                config.id,
                broker.host,
                broker.port,
              );
              remappedBrokers.push(
                `127.0.0.1:${localPort} → ${broker.host}:${broker.port}`,
              );
            }
          }
          return `${cluster.brokers.length} broker(s), controller ${cluster.controller}`;
        } finally {
          await admin.disconnect();
        }
      });

      if (config.schemaRegistry?.url) {
        await run('schema', 'Reach Schema Registry', async () => {
          const subjects = await this.fetchJson<string[]>(config, '/subjects');
          return `${subjects.length} subject(s)`;
        });
      }

      tunnel = this.tunnels.getRuntime(config.id) ?? tunnel;
      await this.tunnels.closeSession(config.id);
      return {
        ok: true,
        steps,
        advertisedListeners,
        remappedBrokers: [...new Set(remappedBrokers)],
        tunnel,
      };
    } catch {
      tunnel = this.tunnels.getRuntime(config.id) ?? tunnel;
      await this.tunnels.closeSession(config.id);
      return {
        ok: false,
        steps,
        advertisedListeners,
        remappedBrokers: [...new Set(remappedBrokers)],
        tunnel,
      };
    }
  }

  rememberName(id: string, name: string) {
    this.names.set(id, name);
  }

  require(id: string): LiveClient {
    const live = this.clients.get(id);
    if (!live || live.status !== 'connected') {
      const name = live?.config.name ?? this.names.get(id);
      throw new NotFoundException(
        `${name ?? 'This cluster'} is not connected. Connect it first.`,
      );
    }
    return live;
  }

  async overview(id: string): Promise<ClusterOverview> {
    const started = Date.now();
    const { admin } = this.require(id);
    this.logger.log(`overview ${id}: describe cluster + topics + group count`);
    this.activity.info(
      'Kafka',
      'Loading overview (cluster + topics + group count)',
      id,
    );
    const [cluster, topics, groups] = await Promise.all([
      admin.describeCluster(),
      admin.fetchTopicMetadata(),
      admin.listGroups(),
    ]);
    const topicInfos = topics.topics.filter(
      (topic) => !INTERNAL_TOPIC.test(topic.name),
    );
    let underReplicated = 0;
    let partitionCount = 0;
    for (const topic of topicInfos) {
      for (const partition of topic.partitions) {
        partitionCount += 1;
        if (partition.isr.length < partition.replicas.length) {
          underReplicated += 1;
        }
      }
    }
    this.logger.log(
      `overview ${id}: ${topicInfos.length} topics, ${cluster.brokers.length} brokers, ${groups.groups.length} groups in ${Date.now() - started}ms`,
    );
    this.activity.info(
      'Kafka',
      `Overview ready: ${topicInfos.length} topics, ${cluster.brokers.length} brokers, ${groups.groups.length} groups (${Date.now() - started}ms)`,
      id,
    );
    const tunnel = this.tunnels.getRuntime(id);
    return {
      clusterId: cluster.clusterId,
      controllerId: Number(cluster.controller),
      brokers: cluster.brokers.map((broker) => ({
        nodeId: broker.nodeId,
        host: broker.host,
        port: broker.port,
        isController: String(broker.nodeId) === String(cluster.controller),
      })),
      topicCount: topicInfos.length,
      partitionCount,
      underReplicatedPartitions: underReplicated,
      consumerGroupCount: groups.groups.length,
      totalLag: 0,
      tunnel: tunnel
        ? {
            connected: tunnel.connected,
            latencyMs: tunnel.latencyMs,
            forwards: tunnel.forwards.length,
          }
        : undefined,
    };
  }

  async listBrokers(id: string): Promise<BrokerInfo[]> {
    const { admin } = this.require(id);
    this.logger.log(`brokers ${id}: describeCluster`);
    const cluster = await admin.describeCluster();
    return cluster.brokers.map((broker) => ({
      nodeId: broker.nodeId,
      host: broker.host,
      port: broker.port,
      isController: String(broker.nodeId) === String(cluster.controller),
    }));
  }

  async listTopics(
    id: string,
    options: { stats?: boolean } = {},
  ): Promise<TopicInfo[]> {
    const cached = this.freshSnapshot(id);
    if (options.stats && cached) {
      return cached.topics;
    }
    const topics =
      cached && !options.stats
        ? this.stripStats(cached.topics)
        : await this.fetchTopicList(id);
    if (!options.stats) {
      return topics;
    }
    return this.enrichTopicStats(id, topics);
  }

  async topicDetail(id: string, name: string): Promise<TopicDetail> {
    const { admin } = this.require(id);
    const snapshot = this.freshSnapshot(id);
    const topics = snapshot?.topics ?? (await this.fetchTopicList(id));
    const topic = topics.find((item) => item.name === name);
    if (!topic) {
      throw new NotFoundException(`Topic ${name} not found`);
    }
    const configs = await admin.describeConfigs({
      includeSynonyms: false,
      resources: [{ type: 2, name }],
    });
    const configMap: Record<string, string> = {};
    for (const entry of configs.resources[0]?.configEntries ?? []) {
      configMap[entry.configName] = entry.configValue;
    }
    const extra = snapshot?.detail.get(name);
    if (extra) {
      return { ...topic, configs: configMap, ...extra };
    }
    const offsets = await this.fetchTopicWatermarks(
      admin,
      name,
      topic.partitions.length,
    );
    const mappedOffsets = offsets.map((offset) => ({
      partitionId: offset.partition,
      low: offset.low,
      high: offset.high,
    }));
    const { consumerGroups, consumerLag } = await this.lagForTopic(
      admin,
      name,
      offsets,
    );
    const messageCount = offsets.reduce(
      (sum, offset) =>
        sum + Math.max(0, Number(offset.high) - Number(offset.low)),
      0,
    );
    return {
      ...topic,
      configs: configMap,
      offsets: mappedOffsets,
      consumerGroups,
      consumerLag,
      messageCount,
      consumerGroupCount: consumerGroups.length,
    };
  }

  async createTopic(id: string, input: CreateTopicInput): Promise<void> {
    const { admin } = this.require(id);
    await admin.createTopics({
      topics: [
        {
          topic: input.name,
          numPartitions: input.partitions,
          replicationFactor: input.replicationFactor,
          configEntries: Object.entries(input.configs ?? {}).map(
            ([name, value]) => ({
              name,
              value,
            }),
          ),
        },
      ],
    });
    this.snapshots.delete(id);
  }

  async deleteTopic(id: string, name: string): Promise<void> {
    const { admin } = this.require(id);
    await admin.deleteTopics({ topics: [name] });
    this.snapshots.delete(id);
  }

  async browseMessages(
    id: string,
    query: BrowseMessagesQuery,
  ): Promise<KafkaMessage[]> {
    const live = this.require(id);
    const limit = Math.min(query.limit ?? 50, 500);
    const offsets = await this.fetchTopicWatermarks(live.admin, query.topic);
    const partitions = offsets.filter((offset) =>
      query.partition === undefined
        ? true
        : offset.partition === query.partition,
    );
    const seeks = partitions.flatMap((partition) => {
      const start = browseStartOffset({
        low: partition.low,
        high: partition.high,
        direction: query.direction,
        offset: query.offset,
        window: browseWindowSize(limit, partitions.length),
      });
      return start === null
        ? []
        : [{ partition: partition.partition, offset: start }];
    });
    if (!seeks.length) {
      return [];
    }

    this.logger.log(
      `browse ${id} ${query.topic}: ${seeks
        .map((seek) => `p${seek.partition}@${seek.offset}`)
        .join(', ')} limit ${limit}`,
    );
    this.activity.info('Kafka', `Peek ${query.topic}`, id);

    const consumer: Consumer = live.kafka.consumer({
      groupId: `kafsheesh-browse-${randomUUID()}`,
      sessionTimeout: 45_000,
      rebalanceTimeout: 60_000,
      heartbeatInterval: 5_000,
      maxWaitTimeInMs: 1_500,
      allowAutoTopicCreation: false,
      readUncommitted: true,
    });
    const messages: KafkaMessage[] = [];
    try {
      await consumer.connect();
      await consumer.subscribe({
        topic: query.topic,
        fromBeginning: query.direction === 'earliest',
      });

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        const fail = (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        };
        const timer = setTimeout(finish, 25_000);
        let sought = false;

        consumer.on(consumer.events.GROUP_JOIN, () => {
          if (sought) {
            return;
          }
          sought = true;
          for (const seek of seeks) {
            consumer.seek({
              topic: query.topic,
              partition: seek.partition,
              offset: seek.offset,
            });
          }
        });
        consumer.on(consumer.events.CRASH, (event) => {
          fail(event.payload.error);
        });

        consumer
          .run({
            autoCommit: false,
            eachBatchAutoResolve: true,
            eachBatch: async (payload) => {
              for (const message of payload.batch.messages) {
                const mapped = this.mapMessage(
                  payload.batch.topic,
                  payload.batch.partition,
                  message,
                );
                if (this.matchesFilter(mapped, query)) {
                  messages.push(mapped);
                }
                payload.resolveOffset(message.offset);
                if (messages.length >= limit) {
                  payload.pause();
                  finish();
                  return;
                }
              }
              await payload.heartbeat();
            },
          })
          .catch(fail);
      });
    } finally {
      await consumer.disconnect().catch(() => undefined);
    }

    this.logger.log(
      `browse ${id} ${query.topic}: returned ${Math.min(messages.length, limit)}`,
    );
    return messages
      .sort((a, b) => Number(BigInt(b.offset) - BigInt(a.offset)))
      .slice(0, limit);
  }

  async produce(id: string, input: ProduceMessageInput): Promise<void> {
    if (!input.value && input.value !== '') {
      throw new BadRequestException('Message value is required');
    }
    const live = this.require(id);
    const producer = live.kafka.producer();
    await producer.connect();
    try {
      await producer.send({
        topic: input.topic,
        messages: [
          {
            key: input.key,
            value: input.value,
            partition: input.partition,
            headers: input.headers,
          },
        ],
      });
    } finally {
      await producer.disconnect();
    }
  }

  async listGroups(id: string): Promise<ConsumerGroupInfo[]> {
    const { admin } = this.require(id);
    const started = Date.now();
    this.logger.log(`groups ${id}: list + describe`);
    const listed = await admin.listGroups();
    if (!listed.groups.length) {
      return [];
    }
    const described = await admin.describeGroups(
      listed.groups.map((group) => group.groupId),
    );
    const results: ConsumerGroupInfo[] = described.groups.map((group) => ({
      groupId: group.groupId,
      state: group.state,
      protocol: group.protocol,
      members: group.members.map((member) => ({
        memberId: member.memberId,
        clientId: member.clientId,
        clientHost: member.clientHost,
        assignments: this.decodeAssignment(member.memberAssignment),
      })),
      lag: 0,
      topics: [],
      offsets: [],
    }));
    this.logger.log(
      `groups ${id}: ${results.length} groups described in ${Date.now() - started}ms`,
    );
    this.activity.info(
      'Kafka',
      `Groups ready: ${results.length} (${Date.now() - started}ms)`,
      id,
    );
    return results.sort((a, b) => a.groupId.localeCompare(b.groupId));
  }

  async resetOffsets(id: string, input: ResetOffsetsInput): Promise<void> {
    const { admin } = this.require(id);
    const topicOffsets = await admin.fetchTopicOffsets(input.topic);
    const partitions = topicOffsets.filter((offset) =>
      input.partitions?.length
        ? input.partitions.includes(offset.partition)
        : true,
    );
    let offsets: Array<{ partition: number; offset: string }>;
    if (input.strategy === 'earliest') {
      offsets = partitions.map((partition) => ({
        partition: partition.partition,
        offset: partition.low,
      }));
    } else if (input.strategy === 'latest') {
      offsets = partitions.map((partition) => ({
        partition: partition.partition,
        offset: partition.high,
      }));
    } else if (input.strategy === 'offset') {
      if (!input.offset) {
        throw new BadRequestException('offset is required');
      }
      offsets = partitions.map((partition) => ({
        partition: partition.partition,
        offset: input.offset!,
      }));
    } else {
      if (!input.timestamp) {
        throw new BadRequestException('timestamp is required');
      }
      const found = await admin.fetchTopicOffsetsByTimestamp(
        input.topic,
        Date.parse(input.timestamp),
      );
      offsets = found
        .filter((partition) =>
          input.partitions?.length
            ? input.partitions.includes(partition.partition)
            : true,
        )
        .map((partition) => ({
          partition: partition.partition,
          offset: partition.offset,
        }));
    }
    await admin.setOffsets({
      groupId: input.groupId,
      topic: input.topic,
      partitions: offsets,
    });
  }

  async deleteGroup(id: string, groupId: string): Promise<void> {
    const { admin } = this.require(id);
    await admin.deleteGroups([groupId]);
  }

  async listSchemas(id: string): Promise<SchemaSubject[]> {
    const live = this.require(id);
    if (!live.config.schemaRegistry?.url) {
      return [];
    }
    const subjects = await this.fetchJson<string[]>(live.config, '/subjects');
    const details: SchemaSubject[] = [];
    for (const subject of subjects) {
      try {
        const latest = await this.fetchJson<{
          version: number;
          schemaType?: string;
          schema: string;
        }>(
          live.config,
          `/subjects/${encodeURIComponent(subject)}/versions/latest`,
        );
        details.push({
          subject,
          latestVersion: latest.version,
          schemaType: latest.schemaType ?? 'AVRO',
          schema: latest.schema,
        });
      } catch {
        details.push({ subject, latestVersion: 0 });
      }
    }
    return details;
  }

  async createSchema(
    id: string,
    input: { subject: string; schema: string; schemaType?: string },
  ): Promise<void> {
    const live = this.require(id);
    await this.fetchJson(
      live.config,
      `/subjects/${encodeURIComponent(input.subject)}/versions`,
      {
        method: 'POST',
        body: JSON.stringify({
          schema: input.schema,
          schemaType: input.schemaType ?? 'AVRO',
        }),
      },
    );
  }

  async deleteSchema(id: string, subject: string): Promise<void> {
    const live = this.require(id);
    await this.fetchJson(
      live.config,
      `/subjects/${encodeURIComponent(subject)}`,
      {
        method: 'DELETE',
      },
    );
  }

  private async buildClient(
    config: ClusterConfig,
    persistTunnel = true,
  ): Promise<Kafka> {
    let brokers = config.brokers;
    if (config.tunnel?.enabled) {
      if (persistTunnel || !this.tunnels.getRuntime(config.id)) {
        await this.tunnels.openSession(config.id, config.tunnel);
      }
      this.logger.log(`SSH is up for ${config.name}; opening local forwards`);
      this.activity.info(
        'Kafka',
        `SSH is up; opening local forwards`,
        config.id,
      );
      const remotes = config.tunnel.remoteBrokers?.length
        ? config.tunnel.remoteBrokers
        : config.brokers;
      brokers = [];
      for (const remote of remotes) {
        const parsed = parseBroker(remote);
        const localPort = await this.tunnels.ensureForward(
          config.id,
          parsed.host,
          parsed.port,
        );
        brokers.push(`127.0.0.1:${localPort}`);
      }
      this.logger.log(
        `Tunnel remapped brokers: ${remotes.join(', ')} → ${brokers.join(', ')}`,
      );
      this.activity.info(
        'Kafka',
        `Brokers remapped ${remotes.join(', ')} → ${brokers.join(', ')}`,
        config.id,
      );
    } else {
      const remapped = rewriteLoopbackBrokers(brokers);
      if (remapped.join(',') !== brokers.join(',')) {
        this.logger.log(
          `Direct Kafka brokers: ${brokers.join(', ')} → ${remapped.join(', ')}`,
        );
        this.activity.info(
          'Kafka',
          `localhost remapped to Compose broker ${remapped.join(', ')}`,
          config.id,
        );
      } else {
        this.logger.log(`Direct Kafka brokers: ${brokers.join(', ')}`);
      }
      brokers = remapped;
    }

    const kafkaConfig: KafkaConfig = {
      clientId: `kafsheesh-${config.id.slice(0, 8)}`,
      brokers,
      ssl: config.ssl || undefined,
      requestTimeout: 20_000,
      connectionTimeout: 12_000,
      logLevel: logLevel.INFO,
      logCreator:
        () =>
        ({ namespace, level, log }) => {
          const line = `[kafkajs ${namespace}] ${log.message}`;
          if (level === logLevel.ERROR) {
            this.logger.error(line);
          } else if (level === logLevel.WARN) {
            this.logger.warn(line);
          } else {
            this.logger.log(line);
          }
        },
    };

    if (config.sasl) {
      kafkaConfig.sasl = {
        mechanism: config.sasl.mechanism,
        username: open(config.sasl.username) ?? config.sasl.username,
        password: open(config.sasl.password) ?? config.sasl.password,
      } as SASLOptions;
    }

    if (config.tunnel?.enabled) {
      kafkaConfig.socketFactory = ({ host, port, ssl, onConnect }) =>
        this.createTunneledSocket(config.id, host, port, ssl, onConnect);
    }

    return new Kafka(kafkaConfig);
  }

  private createTunneledSocket(
    clusterId: string,
    host: string,
    port: number,
    ssl: KafkaConfig['ssl'],
    onConnect?: () => void,
  ): Socket {
    const connectLocal = (localPort: number) => {
      if (ssl) {
        return tlsConnect(
          {
            host: '127.0.0.1',
            port: localPort,
            servername: host === '127.0.0.1' ? undefined : host,
            rejectUnauthorized:
              process.env.KAFSHEESH_TLS_REJECT_UNAUTHORIZED !== 'false',
            ...(typeof ssl === 'object' ? ssl : {}),
          },
          onConnect,
        );
      }
      return netConnect({ host: '127.0.0.1', port: localPort }, onConnect);
    };

    if (isLoopbackHost(host) && this.tunnels.isLiveLocalPort(clusterId, port)) {
      return connectLocal(port);
    }

    const socket = new Socket();
    void this.tunnels
      .ensureForward(clusterId, host, port)
      .then((localPort) => {
        socket.connect(localPort, '127.0.0.1', onConnect);
      })
      .catch((error: Error) => {
        socket.destroy(error);
      });
    return socket;
  }

  private async primeAdvertisedForwards(clusterId: string, admin: Admin) {
    try {
      const cluster = await admin.describeCluster();
      await Promise.all(
        cluster.brokers.map((broker) =>
          this.tunnels.ensureForward(clusterId, broker.host, broker.port),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Could not prime advertised forwards: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private mapMessage(
    topic: string,
    partition: number,
    message: {
      offset: string;
      timestamp: string;
      key: Buffer | null;
      value: Buffer | null;
      headers?: Record<
        string,
        Buffer | string | (Buffer | string)[] | undefined
      >;
      size?: number;
    },
  ): KafkaMessage {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(message.headers ?? {})) {
      if (Array.isArray(value)) {
        headers[key] = value.map((item) => item.toString()).join(',');
      } else if (value) {
        headers[key] = value.toString();
      }
    }
    const value = message.value?.toString() ?? null;
    return {
      topic,
      partition,
      offset: message.offset,
      timestamp: message.timestamp,
      key: message.key?.toString() ?? null,
      value,
      headers,
      size: message.value?.length ?? 0,
    };
  }

  private matchesFilter(
    message: KafkaMessage,
    query: BrowseMessagesQuery,
  ): boolean {
    if (
      query.fromTimestamp &&
      Number(message.timestamp) < Date.parse(query.fromTimestamp)
    ) {
      return false;
    }
    if (
      query.toTimestamp &&
      Number(message.timestamp) > Date.parse(query.toTimestamp)
    ) {
      return false;
    }
    if (query.q) {
      const haystack = `${message.key ?? ''}\n${message.value ?? ''}`;
      try {
        if (!new RegExp(query.q, 'i').test(haystack)) {
          return false;
        }
      } catch {
        if (!haystack.toLowerCase().includes(query.q.toLowerCase())) {
          return false;
        }
      }
    }
    if (query.jsonPath && message.value) {
      try {
        const parsed = JSON.parse(message.value) as unknown;
        if (!this.jsonPathMatches(parsed, query.jsonPath)) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  private jsonPathMatches(value: unknown, expr: string): boolean {
    const path = expr.replace(/^\$\.?/, '');
    const parts = path.split('.').filter(Boolean);
    let current: unknown = value;
    for (const part of parts) {
      const match = part.match(/^([^[\]]+)(?:\[(\d+)\])?$/);
      if (!match || typeof current !== 'object' || current === null) {
        return false;
      }
      current = (current as Record<string, unknown>)[match[1]];
      if (match[2] !== undefined) {
        if (!Array.isArray(current)) {
          return false;
        }
        current = current[Number(match[2])];
      }
    }
    return current !== undefined && current !== null;
  }

  private decodeAssignment(
    assignment: Buffer | string | undefined,
  ): Array<{ topic: string; partitions: number[] }> {
    if (!assignment) {
      return [];
    }
    try {
      const text =
        typeof assignment === 'string'
          ? assignment
          : assignment.toString('utf8');
      if (text.includes('topic')) {
        return [{ topic: text, partitions: [] }];
      }
    } catch {
      return [];
    }
    return [];
  }

  private async fetchJson<T>(
    config: ClusterConfig,
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const base = config.schemaRegistry?.url.replace(/\/$/, '');
    if (!base) {
      throw new BadRequestException('Schema Registry is not configured');
    }
    const headers: Record<string, string> = {
      accept: 'application/vnd.schemaregistry.v1+json, application/json',
      'content-type': 'application/vnd.schemaregistry.v1+json',
    };
    const username =
      open(config.schemaRegistry?.username) ?? config.schemaRegistry?.username;
    const password =
      open(config.schemaRegistry?.password) ?? config.schemaRegistry?.password;
    if (username) {
      headers.authorization = `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}`;
    }
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...headers, ...init?.headers },
    });
    if (!response.ok) {
      throw new Error(
        `Schema Registry ${response.status} ${response.statusText}`,
      );
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  private freshSnapshot(id: string): TopicSnapshot | undefined {
    const snapshot = this.snapshots.get(id);
    if (!snapshot || Date.now() - snapshot.at > SNAPSHOT_TTL_MS) {
      return undefined;
    }
    return snapshot;
  }

  private stripStats(topics: TopicInfo[]): TopicInfo[] {
    return topics.map((topic) => ({
      ...topic,
      consumerLag: undefined,
      messageCount: undefined,
      consumerGroupCount: undefined,
    }));
  }

  private async fetchTopicList(id: string): Promise<TopicInfo[]> {
    const { admin } = this.require(id);
    this.logger.log(`topics ${id}: fetchTopicMetadata`);
    const started = Date.now();
    const meta = await admin.fetchTopicMetadata();
    this.logger.log(
      `topics ${id}: ${meta.topics.length} topics in ${Date.now() - started}ms`,
    );
    this.activity.info(
      'Kafka',
      `Topics ready: ${meta.topics.length} (${Date.now() - started}ms)`,
      id,
    );
    return meta.topics
      .filter((topic) => !INTERNAL_TOPIC.test(topic.name))
      .map((topic) => {
        const underReplicated = topic.partitions.some(
          (partition) => partition.isr.length < partition.replicas.length,
        );
        const offlinePartitions = topic.partitions.filter(
          (partition) =>
            (partition.offlineReplicas?.length ?? 0) > 0 ||
            partition.leader === -1,
        ).length;
        return {
          name: topic.name,
          partitions: topic.partitions.map((partition) => ({
            partitionId: partition.partitionId,
            leader: partition.leader,
            replicas: partition.replicas,
            isr: partition.isr,
            offlineReplicas: partition.offlineReplicas ?? [],
          })),
          replicaCount: topic.partitions[0]?.replicas.length ?? 0,
          underReplicated,
          offlinePartitions,
          internal: Boolean(topic.name.startsWith('_')),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async enrichTopicStats(
    id: string,
    topics: TopicInfo[],
  ): Promise<TopicInfo[]> {
    const { admin } = this.require(id);
    const started = Date.now();
    this.activity.info(
      'Kafka',
      `Loading topic offsets and group lag (${topics.length} topics)`,
      id,
    );

    const highByTopic = new Map<
      string,
      Map<number, { low: number; high: number }>
    >();
    const offsetsByTopic = new Map<string, TopicDetail['offsets']>();

    await mapPool(topics, 8, async (topic) => {
      try {
        const offsets = await this.fetchTopicWatermarks(
          admin,
          topic.name,
          topic.partitions.length,
        );
        const parts = new Map<number, { low: number; high: number }>();
        offsetsByTopic.set(
          topic.name,
          offsets.map((offset) => {
            parts.set(offset.partition, {
              low: Number(offset.low),
              high: Number(offset.high),
            });
            return {
              partitionId: offset.partition,
              low: offset.low,
              high: offset.high,
            };
          }),
        );
        highByTopic.set(topic.name, parts);
      } catch (error) {
        this.logger.warn(
          `offsets ${topic.name}: ${error instanceof Error ? error.message : error}`,
        );
      }
    });

    const lagByTopic = new Map<string, number>();
    const groupsByTopic = new Map<string, TopicDetail['consumerGroups']>();
    const listed = await admin.listGroups();
    const described = listed.groups.length
      ? await admin.describeGroups(listed.groups.map((group) => group.groupId))
      : { groups: [] };
    const stateById = new Map(
      described.groups.map((group) => [group.groupId, group.state]),
    );

    await mapPool(listed.groups, 8, async (group) => {
      try {
        const committed = await admin.fetchOffsets({ groupId: group.groupId });
        for (const entry of committed) {
          let topicLag = 0;
          for (const partition of entry.partitions) {
            const watermark = highByTopic
              .get(entry.topic)
              ?.get(partition.partition);
            const current = Number(partition.offset);
            if (!watermark || !Number.isFinite(current) || current < 0) {
              continue;
            }
            topicLag += Math.max(0, watermark.high - current);
          }
          lagByTopic.set(
            entry.topic,
            (lagByTopic.get(entry.topic) ?? 0) + topicLag,
          );
          const groups = groupsByTopic.get(entry.topic) ?? [];
          groups.push({
            groupId: group.groupId,
            lag: topicLag,
            state: stateById.get(group.groupId) ?? '',
          });
          groupsByTopic.set(entry.topic, groups);
        }
      } catch (error) {
        this.logger.warn(
          `group offsets ${group.groupId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    });

    const enriched = topics.map((topic) => {
      const parts = highByTopic.get(topic.name);
      let messageCount: number | undefined;
      if (parts) {
        messageCount = 0;
        for (const { low, high } of parts.values()) {
          messageCount += Math.max(0, high - low);
        }
      }
      const groups = groupsByTopic.get(topic.name) ?? [];
      return {
        ...topic,
        messageCount,
        consumerLag: lagByTopic.get(topic.name) ?? 0,
        consumerGroupCount: groups.length,
      };
    });

    this.snapshots.set(id, {
      at: Date.now(),
      topics: enriched,
      detail: new Map(
        enriched.map((topic) => [
          topic.name,
          {
            offsets: offsetsByTopic.get(topic.name) ?? [],
            consumerGroups: groupsByTopic.get(topic.name) ?? [],
            consumerLag: topic.consumerLag,
            messageCount: topic.messageCount,
          },
        ]),
      ),
    });

    this.logger.log(
      `topic stats ${id}: ${enriched.length} topics in ${Date.now() - started}ms`,
    );
    this.activity.info(
      'Kafka',
      `Topic stats ready (${Date.now() - started}ms)`,
      id,
    );
    return enriched;
  }

  private async lagForTopic(
    admin: Admin,
    name: string,
    offsets: Array<{ partition: number; high: string }>,
  ): Promise<{
    consumerGroups: TopicDetail['consumerGroups'];
    consumerLag: number;
  }> {
    const high = new Map(
      offsets.map((offset) => [offset.partition, Number(offset.high)]),
    );
    const listed = await admin.listGroups();
    const consumerGroups: TopicDetail['consumerGroups'] = [];
    let consumerLag = 0;
    await mapPool(listed.groups, 8, async (group) => {
      try {
        const committed = await admin.fetchOffsets({
          groupId: group.groupId,
          topics: [name],
        });
        let topicLag = 0;
        for (const entry of committed) {
          if (entry.topic !== name) {
            continue;
          }
          for (const partition of entry.partitions) {
            const watermark = high.get(partition.partition);
            const current = Number(partition.offset);
            if (
              watermark === undefined ||
              !Number.isFinite(current) ||
              current < 0
            ) {
              continue;
            }
            topicLag += Math.max(0, watermark - current);
          }
        }
        if (topicLag > 0 || committed.some((entry) => entry.topic === name)) {
          consumerGroups.push({
            groupId: group.groupId,
            lag: topicLag,
            state: '',
          });
          consumerLag += topicLag;
        }
      } catch {
        return;
      }
    });
    return { consumerGroups, consumerLag };
  }

  /**
   * KafkaJS fetchTopicOffsets does `high.pop()` and throws TypeError when ListOffsets
   * returns no topic entry (0 partitions, no leader, or stale cluster metadata).
   */
  private async fetchTopicWatermarks(
    admin: Admin,
    name: string,
    partitionCount?: number,
  ): Promise<
    Array<{ partition: number; low: string; high: string; offset: string }>
  > {
    if (partitionCount === 0) {
      return [];
    }
    try {
      return await admin.fetchTopicOffsets(name);
    } catch (error) {
      if (!isEmptyListOffsetsError(error)) {
        throw error;
      }
      const meta = await admin.fetchTopicMetadata({ topics: [name] });
      const partitions =
        meta.topics.find((topic) => topic.name === name)?.partitions ?? [];
      if (
        !partitions.length ||
        partitions.every((partition) => partition.leader < 0)
      ) {
        this.logger.warn(
          `offsets ${name}: skipped (no partitions or no leader)`,
        );
        return [];
      }
      try {
        return await admin.fetchTopicOffsets(name);
      } catch (retryError) {
        if (isEmptyListOffsetsError(retryError)) {
          this.logger.warn(
            `offsets ${name}: brokers returned no watermarks after metadata refresh`,
          );
          return [];
        }
        throw retryError;
      }
    }
  }
}

function isEmptyListOffsetsError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message.includes("Cannot destructure property 'partitions'")
  );
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) || 0 }, () => run()),
  );
  return results;
}
