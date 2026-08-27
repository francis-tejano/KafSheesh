export interface BrokerInfo {
  nodeId: number;
  host: string;
  port: number;
  rack?: string;
  isController: boolean;
}

export interface PartitionInfo {
  partitionId: number;
  leader: number;
  replicas: number[];
  isr: number[];
  offlineReplicas: number[];
}

export interface TopicInfo {
  name: string;
  partitions: PartitionInfo[];
  replicaCount: number;
  underReplicated: boolean;
  internal: boolean;
  offlinePartitions?: number;
  configs?: Record<string, string>;
  /** Combined consumer-group lag across groups reading this topic. */
  consumerLag?: number;
  messageCount?: number;
  consumerGroupCount?: number;
}

export interface TopicDetail extends TopicInfo {
  configs: Record<string, string>;
  offsets: Array<{
    partitionId: number;
    low: string;
    high: string;
  }>;
  consumerGroups: Array<{
    groupId: string;
    lag: number;
    state: string;
  }>;
}

export interface CreateTopicInput {
  name: string;
  partitions: number;
  replicationFactor: number;
  configs?: Record<string, string>;
}

export interface KafkaMessage {
  topic: string;
  partition: number;
  offset: string;
  timestamp: string;
  key: string | null;
  value: string | null;
  headers: Record<string, string>;
  size: number;
}

export interface BrowseMessagesQuery {
  topic: string;
  partition?: number;
  offset?: string;
  limit?: number;
  direction?: 'latest' | 'earliest' | 'offset';
  q?: string;
  jsonPath?: string;
  fromTimestamp?: string;
  toTimestamp?: string;
}

export interface ProduceMessageInput {
  topic: string;
  key?: string;
  value: string;
  partition?: number;
  headers?: Record<string, string>;
}

export interface ConsumerGroupMember {
  memberId: string;
  clientId: string;
  clientHost: string;
  assignments: Array<{ topic: string; partitions: number[] }>;
}

export interface ConsumerGroupLag {
  topic: string;
  partition: number;
  currentOffset: string;
  logEndOffset: string;
  lag: number;
}

export interface ConsumerGroupInfo {
  groupId: string;
  state: string;
  protocol: string;
  members: ConsumerGroupMember[];
  lag: number;
  topics: string[];
  offsets?: ConsumerGroupLag[];
}

export type OffsetResetStrategy = 'earliest' | 'latest' | 'timestamp' | 'offset';

export interface ResetOffsetsInput {
  groupId: string;
  topic: string;
  strategy: OffsetResetStrategy;
  partitions?: number[];
  timestamp?: string;
  offset?: string;
}

export interface ClusterOverview {
  clusterId: string;
  controllerId?: number;
  brokers: BrokerInfo[];
  topicCount: number;
  partitionCount: number;
  underReplicatedPartitions: number;
  consumerGroupCount: number;
  totalLag: number;
  tunnel?: {
    connected: boolean;
    latencyMs?: number;
    forwards: number;
  };
}

export interface SchemaSubject {
  subject: string;
  latestVersion: number;
  compatibility?: string;
  schemaType?: string;
  schema?: string;
}

export interface SavedSearch {
  id: string;
  clusterId: string;
  name: string;
  topic: string;
  q?: string;
  jsonPath?: string;
  createdAt: string;
}
