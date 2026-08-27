import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, Subject } from 'rxjs';
import type { ActivityEvent, ActivityLevel } from '@kafsheesh/shared';

@Injectable()
export class ActivityService {
  private readonly logger = new Logger('Activity');
  private readonly events: ActivityEvent[] = [];
  private readonly live = new Subject<ActivityEvent>();

  recent(): ActivityEvent[] {
    return this.events.slice(-250);
  }

  stream(): Observable<ActivityEvent> {
    return this.live.asObservable();
  }

  info(source: string, message: string, clusterId?: string) {
    this.write('info', source, message, clusterId);
  }

  warn(source: string, message: string, clusterId?: string) {
    this.write('warn', source, message, clusterId);
  }

  error(source: string, message: string, clusterId?: string) {
    this.write('error', source, message, clusterId);
  }

  private write(level: ActivityLevel, source: string, message: string, clusterId?: string) {
    const event: ActivityEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      level,
      source,
      message,
      clusterId,
    };
    this.events.push(event);
    if (this.events.length > 400) {
      this.events.splice(0, this.events.length - 300);
    }
    this.live.next(event);
    const line = clusterId ? `${message} [${clusterId.slice(0, 8)}]` : message;
    if (level === 'error') {
      this.logger.error(`[${source}] ${line}`);
    } else if (level === 'warn') {
      this.logger.warn(`[${source}] ${line}`);
    } else {
      this.logger.log(`[${source}] ${line}`);
    }
  }
}
