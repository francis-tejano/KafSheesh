import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import type { ActivityEvent } from '@kafsheesh/shared';

const OPEN_KEY = 'kafsheesh.activity.open';

@Injectable({ providedIn: 'root' })
export class ActivityFeedService {
  private readonly http = inject(HttpClient);
  readonly events = signal<ActivityEvent[]>([]);
  readonly open = signal(readOpen());
  readonly connected = signal(false);
  readonly filter = signal<'all' | 'issues'>('all');
  readonly following = signal(true);
  readonly unseen = signal(0);

  readonly latest = computed(() => this.events().at(-1) ?? null);
  readonly issueCount = computed(
    () => this.events().filter((event) => event.level !== 'info').length,
  );
  readonly visible = computed(() => {
    const events = this.events();
    return this.filter() === 'issues'
      ? events.filter((event) => event.level !== 'info')
      : events;
  });

  constructor() {
    this.http.get<ActivityEvent[]>('/api/activity').subscribe({
      next: (events) => this.events.set(events),
      error: () => undefined,
    });
    this.listen();
  }

  toggle() {
    this.open.update((value) => !value);
    writeOpen(this.open());
    if (this.open()) {
      this.following.set(true);
      this.unseen.set(0);
    }
  }

  clear() {
    this.events.set([]);
    this.unseen.set(0);
  }

  setFilter(filter: 'all' | 'issues') {
    this.filter.set(filter);
    this.following.set(true);
  }

  markSeen() {
    this.unseen.set(0);
  }

  private listen() {
    const source = new EventSource('/api/activity/stream');
    source.onopen = () => this.connected.set(true);
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as ActivityEvent;
        this.events.update((list) => {
          const index = list.findIndex((item) => item.id === event.id);
          if (index >= 0) {
            const next = list.slice();
            next[index] = event;
            return next;
          }
          return [...list, event].slice(-250);
        });
        if (!this.open() || !this.following()) {
          this.unseen.update((count) => count + 1);
        }
      } catch {
        return;
      }
    };
    source.onerror = () => {
      this.connected.set(false);
      source.close();
      window.setTimeout(() => this.listen(), 2000);
    };
  }
}

function readOpen() {
  try {
    return sessionStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeOpen(open: boolean) {
  try {
    sessionStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    return;
  }
}
