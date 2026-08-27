import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { TopicInfo } from '@kafsheesh/shared';
import { map } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ConfirmService } from '../../core/confirm.service';
import { FlagsService } from '../../core/flags.service';
import { listFilterNavExtras, persistListFilter } from '../../core/list-filter';

@Component({
  selector: 'app-topics',
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1>Topics</h1>
        <p>
          {{ topics().length }} topics
          @if (statsLoading()) {
            · loading offsets and lag…
          }
        </p>
      </div>
      <div class="row">
        <button class="btn ghost" (click)="load()" [disabled]="loading()">Refresh</button>
        @if (!flags.disableDestructive()) {
          <button class="btn primary" (click)="showCreate.set(!showCreate())">
            {{ showCreate() ? 'Cancel' : 'New topic' }}
          </button>
        }
      </div>
    </div>

    @if (error()) {
      <div class="banner">{{ error() }}</div>
    }
    @if (loading()) {
      <div class="card empty">Loading topics…</div>
    }

    <div class="grid stats" style="margin-bottom:16px">
      <div class="card stat clickable" [class.active]="health() === 'all'" (click)="setHealth('all')">
        <div class="label">Topics</div>
        <div class="value" [class.pending]="loading()">{{ loading() ? 'Fetching…' : summary().total.toLocaleString() }}</div>
      </div>
      <div
        class="card stat clickable"
        [class.active]="health() === 'healthy'"
        [class.tone-ok]="summary().healthy > 0"
        (click)="setHealth('healthy')"
      >
        <div class="label">Healthy</div>
        <div class="value" [class.pending]="loading()">{{ loading() ? 'Fetching…' : summary().healthy.toLocaleString() }}</div>
      </div>
      <div
        class="card stat clickable"
        [class.active]="health() === 'under-replicated'"
        [class.tone-err]="summary().underReplicated > 0"
        (click)="setHealth('under-replicated')"
      >
        <div class="label">Under-replicated</div>
        <div class="value" [class.pending]="loading()">{{ loading() ? 'Fetching…' : summary().underReplicated.toLocaleString() }}</div>
        <div class="hint">ISR smaller than RF</div>
      </div>
      <div
        class="card stat clickable"
        [class.active]="health() === 'offline'"
        [class.tone-err]="summary().offline > 0"
        (click)="setHealth('offline')"
      >
        <div class="label">Offline</div>
        <div class="value" [class.pending]="loading()">{{ loading() ? 'Fetching…' : summary().offline.toLocaleString() }}</div>
        <div class="hint">No leader or offline replicas</div>
      </div>
    </div>

    @if (showCreate() && !flags.disableDestructive()) {
      <form class="card" style="margin-bottom:16px" (ngSubmit)="create()">
        <div class="grid stats">
          <label><span>Name</span><input name="name" [(ngModel)]="newName" required /></label>
          <label><span>Partitions</span><input name="p" type="number" [(ngModel)]="newPartitions" /></label>
          <label><span>Replication</span><input name="r" type="number" [(ngModel)]="newReplication" /></label>
          <div style="align-self:end"><button class="btn primary">Create</button></div>
        </div>
      </form>
    }

    <div class="toolbar">
      <label>
        <span>Filter</span>
        <input [ngModel]="query()" (ngModelChange)="setQuery($event)" name="q" placeholder="orders, payments…" />
      </label>
      <span class="help">{{ filtered().length }} shown</span>
    </div>

    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>Topic</th>
            <th>Partitions</th>
            <th>RF</th>
            <th>Messages</th>
            <th>Lag</th>
            <th>Groups</th>
            <th>Health</th>
          </tr>
        </thead>
        <tbody>
          @for (topic of filtered(); track topic.name) {
            <tr class="clickable" (click)="open(topic.name)">
              <td class="mono">{{ topic.name }}</td>
              <td>{{ topic.partitions.length }}</td>
              <td>{{ topic.replicaCount }}</td>
              <td>{{ formatCount(topic.messageCount) }}</td>
              <td>{{ formatCount(topic.consumerLag) }}</td>
              <td>{{ formatCount(topic.consumerGroupCount) }}</td>
              <td>
                @if (topic.offlinePartitions) {
                  <span class="pill err">offline</span>
                } @else if (topic.underReplicated) {
                  <span class="pill err">under-replicated</span>
                } @else {
                  <span class="pill ok">healthy</span>
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="7" class="help">{{ query() ? 'No topics match that filter.' : 'No topics yet.' }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class TopicsPage {
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  readonly flags = inject(FlagsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly id = toSignal(
    this.route.parent!.paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: this.route.parent?.snapshot.paramMap.get('id') ?? '' },
  );
  readonly topics = signal<TopicInfo[]>([]);
  readonly error = signal('');
  readonly loading = signal(false);
  readonly statsLoading = signal(false);
  readonly showCreate = signal(false);
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly query = computed(() => this.queryParams().get('filter') ?? '');
  readonly health = signal<'all' | 'healthy' | 'under-replicated' | 'offline'>('all');
  readonly summary = computed(() => {
    let healthy = 0;
    let underReplicated = 0;
    let offline = 0;
    for (const topic of this.topics()) {
      if (topic.offlinePartitions) {
        offline += 1;
      } else if (topic.underReplicated) {
        underReplicated += 1;
      } else {
        healthy += 1;
      }
    }
    return { total: this.topics().length, healthy, underReplicated, offline };
  });
  readonly filtered = computed(() => {
    const q = this.query().toLowerCase();
    const health = this.health();
    return this.topics().filter((topic) => {
      if (q && !topic.name.toLowerCase().includes(q)) {
        return false;
      }
      if (health === 'offline') {
        return Boolean(topic.offlinePartitions);
      }
      if (health === 'under-replicated') {
        return !topic.offlinePartitions && topic.underReplicated;
      }
      if (health === 'healthy') {
        return !topic.offlinePartitions && !topic.underReplicated;
      }
      return true;
    });
  });
  newName = '';
  newPartitions = 3;
  newReplication = 1;

  constructor() {
    this.load();
  }

  setQuery(value: string) {
    persistListFilter(this.router, this.route, value);
  }

  setHealth(next: 'all' | 'healthy' | 'under-replicated' | 'offline') {
    this.health.update((current) => (next === 'all' || current === next ? 'all' : next));
  }

  open(name: string) {
    void this.router.navigate(['/c', this.id(), 'topics', name], listFilterNavExtras(this.query()));
  }

  formatCount(value: number | undefined): string {
    if (value === undefined) {
      return this.statsLoading() ? '…' : '—';
    }
    return value.toLocaleString();
  }

  load() {
    this.loading.set(true);
    this.api.topics(this.id()).subscribe({
      next: (topics) => {
        this.topics.set(topics);
        this.loading.set(false);
        this.loadStats();
      },
      error: (err: { error?: { message?: string } }) => {
        this.loading.set(false);
        this.error.set(err.error?.message ?? 'Failed to load topics');
      },
    });
  }

  private loadStats() {
    this.statsLoading.set(true);
    this.api.topics(this.id(), { stats: true }).subscribe({
      next: (topics) => {
        this.topics.set(topics);
        this.statsLoading.set(false);
      },
      error: () => this.statsLoading.set(false),
    });
  }

  async create() {
    const ok = await this.confirm.ask({
      title: 'Create topic',
      message: `Create ${this.newName} on this cluster with ${this.newPartitions} partitions and replication factor ${this.newReplication}? This writes to Kafka.`,
      confirmLabel: 'Create topic',
    });
    if (!ok) {
      return;
    }
    this.api
      .createTopic(this.id(), {
        name: this.newName,
        partitions: this.newPartitions,
        replicationFactor: this.newReplication,
      })
      .subscribe({
        next: () => {
          this.showCreate.set(false);
          this.newName = '';
          this.load();
        },
        error: (err: { error?: { message?: string } }) =>
          this.error.set(err.error?.message ?? 'Create failed'),
      });
  }
}
