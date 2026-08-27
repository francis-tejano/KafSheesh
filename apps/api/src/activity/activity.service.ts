import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, Subject } from 'rxjs';
import type { ActivityEvent, ActivityLevel, ActivityStatus } from '@kafsheesh/shared';

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
    return this.write('info', source, message, clusterId);
  }

  warn(source: string, message: string, clusterId?: string) {
    return this.write('warn', source, message, clusterId);
  }

  error(source: string, message: string, clusterId?: string) {
    return this.write('error', source, message, clusterId);
  }

  begin(source: string, message: string, clusterId?: string) {
    return this.write('info', source, message, clusterId, 'ongoing');
  }

  finish(id: string, status: Exclude<ActivityStatus, 'ongoing'>, message?: string) {
    const index = this.events.findIndex((event) => event.id === id);
    if (index === -1) {
      return;
    }
    const next: ActivityEvent = {
      ...this.events[index],
      at: new Date().toISOString(),
      status,
      level: status === 'error' ? 'error' : this.events[index].level,
      message: message ?? this.events[index].message,
    };
    this.events[index] = next;
    this.live.next(next);
    this.log(next);
  }

  private write(
    level: ActivityLevel,
    source: string,
    message: string,
    clusterId?: string,
    status?: ActivityStatus,
  ) {
    const event: ActivityEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      level,
      source,
      message,
      clusterId,
      status,
    };
    this.events.push(event);
    if (this.events.length > 400) {
      this.events.splice(0, this.events.length - 300);
    }
    this.live.next(event);
    this.log(event);
    return event;
  }

  private log(event: ActivityEvent) {
    const line = event.clusterId ? `${event.message} [${event.clusterId.slice(0, 8)}]` : event.message;
    if (event.level === 'error') {
      this.logger.error(`[${event.source}] ${line}`);
    } else if (event.level === 'warn') {
      this.logger.warn(`[${event.source}] ${line}`);
    } else {
      this.logger.log(`[${event.source}] ${line}`);
    }
  }
}
