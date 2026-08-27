export type ActivityLevel = 'info' | 'warn' | 'error';

export type ActivityStatus = 'ongoing' | 'ok' | 'error';

export interface ActivityEvent {
  id: string;
  at: string;
  level: ActivityLevel;
  source: string;
  message: string;
  clusterId?: string;
  status?: ActivityStatus;
}
