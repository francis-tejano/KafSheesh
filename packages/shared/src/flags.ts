export interface AppFlags {
  /** When true, Kafka writes and other irreversible actions are rejected. */
  disableDestructive: boolean;
}

export interface HealthInfo {
  name: string;
  status: string;
  time: string;
  flags: AppFlags;
  /** Where cluster, search, audit, and DNS cache records live. */
  store?: 'json' | 'postgres';
}
