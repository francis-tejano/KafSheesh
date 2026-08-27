export type TunnelAuthType = 'password' | 'privateKey';

export type SaslMechanism =
  | 'plain'
  | 'scram-sha-256'
  | 'scram-sha-512';

export interface JumpHop {
  host: string;
  port: number;
  username: string;
  authType: TunnelAuthType;
  password?: string;
  privateKey?: string;
  privateKeyFileName?: string;
  passphrase?: string;
  /** Optional IP or hostname to dial when `host` is not visible to the API process DNS. */
  connectHost?: string;
}

export interface TunnelConfig {
  enabled: boolean;
  /** Bastion / jump host that can reach Kafka (server2). */
  host: string;
  port: number;
  username: string;
  authType: TunnelAuthType;
  password?: string;
  privateKey?: string;
  /** Original file name for PEM / PPK uploads. */
  privateKeyFileName?: string;
  passphrase?: string;
  /** Optional IP or hostname to dial when `host` is not visible to the API process DNS. */
  connectHost?: string;
  /**
   * Extra hops before the bastion. Connection order is hops[0] → hops[n] → host.
   */
  hops?: JumpHop[];
  /**
   * Brokers as seen from the bastion, e.g. kafka.internal:9092.
   * Used when advertised listeners are not reachable from the UI host.
   */
  remoteBrokers?: string[];
  keepAliveIntervalMs?: number;
}

export interface SaslConfig {
  mechanism: SaslMechanism;
  username: string;
  password: string;
}

export interface SchemaRegistryConfig {
  url: string;
  username?: string;
  password?: string;
}

export interface ClusterConfig {
  id: string;
  name: string;
  /** Brokers from this machine, or from the bastion when a tunnel is enabled. */
  brokers: string[];
  tunnel?: TunnelConfig;
  ssl?: boolean;
  sasl?: SaslConfig;
  schemaRegistry?: SchemaRegistryConfig;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type ClusterStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'degraded'
  | 'error';

export interface TunnelRuntime {
  connected: boolean;
  bastion: string;
  hops: number;
  forwards: Array<{ remote: string; localPort: number }>;
  latencyMs?: number;
  lastError?: string;
  connectedAt?: string;
}

export interface ClusterRuntime {
  id: string;
  status: ClusterStatus;
  lastError?: string;
  connectedAt?: string;
  tunnel?: TunnelRuntime;
  brokerCount?: number;
  controllerId?: number;
}

export interface ClusterSummary extends ClusterConfig {
  runtime: ClusterRuntime;
}

export interface CreateClusterInput {
  name: string;
  brokers: string[];
  tunnel?: TunnelConfig;
  ssl?: boolean;
  sasl?: SaslConfig;
  schemaRegistry?: SchemaRegistryConfig;
  notes?: string;
}

export type UpdateClusterInput = Partial<CreateClusterInput>;

export type DiagnosticStepStatus = 'pending' | 'running' | 'ok' | 'warn' | 'error';

export interface DiagnosticStep {
  id: string;
  label: string;
  status: DiagnosticStepStatus;
  detail?: string;
  durationMs?: number;
}

export interface ConnectionDiagnostic {
  ok: boolean;
  steps: DiagnosticStep[];
  advertisedListeners: string[];
  remappedBrokers: string[];
  tunnel?: TunnelRuntime;
}
