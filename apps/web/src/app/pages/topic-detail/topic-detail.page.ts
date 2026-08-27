import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { KafkaMessage, SavedSearch, TopicDetail } from '@kafsheesh/shared';
import { map } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ConfirmService } from '../../core/confirm.service';
import { formatLocalTime } from '../../core/local-time';

@Component({
  selector: 'app-topic-detail',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <h1 class="mono">{{ name() }}</h1>
        <p>Inspect offsets, filter messages, produce, and keep searches.</p>
      </div>
      <div class="row">
        <a class="btn ghost" [routerLink]="['/c', id(), 'topics']">All topics</a>
        <button class="btn danger" (click)="remove()">Delete topic</button>
      </div>
    </div>

    @if (error()) {
      <div class="banner">{{ error() }}</div>
    }

    @if (topic(); as detail) {
      <div class="grid stats">
        <div class="card stat"><div class="label">Partitions</div><div class="value">{{ detail.partitions.length }}</div></div>
        <div class="card stat"><div class="label">Replication</div><div class="value">{{ detail.replicaCount }}</div></div>
        <div class="card stat"><div class="label">Messages</div><div class="value">{{ (detail.messageCount ?? 0).toLocaleString() }}</div></div>
        <div class="card stat"><div class="label">Lag</div><div class="value">{{ (detail.consumerLag ?? 0).toLocaleString() }}</div></div>
      </div>
      @if (detail.consumerGroups.length) {
        <div class="card table-wrap" style="margin-top:16px">
          <h3>Consumer groups</h3>
          <table>
            <thead><tr><th>Group</th><th>State</th><th>Lag</th></tr></thead>
            <tbody>
              @for (group of detail.consumerGroups; track group.groupId) {
                <tr>
                  <td class="mono">{{ group.groupId }}</td>
                  <td>{{ group.state || '—' }}</td>
                  <td>{{ group.lag.toLocaleString() }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }

    <div class="grid two" style="margin-top:16px">
      <form class="card" (ngSubmit)="loadMessages()">
        <h3>Message browser</h3>
        <p class="help">Browsing pulls records through the tunnel. Load only when you need them.</p>
        <div class="grid two">
          <label><span>Direction</span>
            <select name="dir" [(ngModel)]="direction">
              <option value="latest">Latest</option>
              <option value="earliest">Earliest</option>
            </select>
          </label>
          <label><span>Limit</span><input name="limit" type="number" [(ngModel)]="limit" /></label>
        </div>
        <label><span>Regex / text filter</span><input name="q" [(ngModel)]="q" placeholder="error|timeout" /></label>
        <label><span>JSON path must exist</span><input name="jp" [(ngModel)]="jsonPath" placeholder="user.id" /></label>
        <div class="row">
          <button class="btn primary" [disabled]="loadingMessages()">
            {{ loadingMessages() ? 'Loading…' : 'Load messages' }}
          </button>
          <button type="button" class="btn ghost" (click)="saveSearch()">Save search</button>
        </div>
        @if (searches().length) {
          <div class="row" style="margin-top:12px">
            @for (search of searches(); track search.id) {
              <button type="button" class="pill btnish" (click)="applySearch(search)">{{ search.name }}</button>
            }
          </div>
        }
      </form>

      <form class="card" (ngSubmit)="produce()">
        <h3>Produce</h3>
        <label><span>Key</span><input name="key" [(ngModel)]="produceKey" /></label>
        <label><span>Value</span><textarea name="value" [(ngModel)]="produceValue" required></textarea></label>
        <button class="btn primary" [disabled]="producing()">{{ producing() ? 'Sending…' : 'Send' }}</button>
      </form>
    </div>

    <div class="card table-wrap" style="margin-top:16px">
      <div class="row" style="justify-content:space-between;margin-bottom:8px">
        <h3 style="margin:0">Messages</h3>
        <span class="help">{{ messages().length }} loaded · local time</span>
      </div>
      <table>
        <thead>
          <tr><th>P</th><th>Offset</th><th>Key</th><th>Value</th><th>Time</th></tr>
        </thead>
        <tbody>
          @for (message of messages(); track message.partition + ':' + message.offset) {
            <tr>
              <td>{{ message.partition }}</td>
              <td class="mono">{{ message.offset }}</td>
              <td class="mono">{{ message.key }}</td>
              <td class="mono message-value">{{ message.value }}</td>
              <td class="help">{{ localTime(message.timestamp, true) }}</td>
            </tr>
          } @empty {
            <tr>
              <td colspan="5" class="help">
                {{ loadingMessages() ? 'Fetching through the tunnel…' : 'No messages loaded yet. Choose a filter and load.' }}
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class TopicDetailPage {
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly localTime = formatLocalTime;

  readonly id = toSignal(
    this.route.parent!.paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: this.route.parent?.snapshot.paramMap.get('id') ?? '' },
  );
  readonly name = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('name') ?? '')),
    { initialValue: this.route.snapshot.paramMap.get('name') ?? '' },
  );

  readonly topic = signal<TopicDetail | null>(null);
  readonly messages = signal<KafkaMessage[]>([]);
  readonly searches = signal<SavedSearch[]>([]);
  readonly error = signal('');
  readonly loadingMessages = signal(false);
  readonly producing = signal(false);
  direction = 'latest';
  limit = 50;
  q = '';
  jsonPath = '';
  produceKey = '';
  produceValue = '{\n  "hello": "kafsheesh"\n}';

  constructor() {
    this.api.topic(this.id(), this.name()).subscribe({
      next: (topic) => this.topic.set(topic),
      error: (err: { error?: { message?: string } }) =>
        this.error.set(err.error?.message ?? 'Failed to load topic'),
    });
    this.api.searches(this.id()).subscribe((searches) =>
      this.searches.set(searches.filter((search) => search.topic === this.name())),
    );
  }

  loadMessages() {
    this.loadingMessages.set(true);
    this.error.set('');
    this.api
      .messages(this.id(), this.name(), {
        limit: this.limit,
        direction: this.direction,
        q: this.q,
        jsonPath: this.jsonPath,
      })
      .subscribe({
        next: (messages) => {
          this.messages.set(messages);
          this.loadingMessages.set(false);
        },
        error: (err: { error?: { message?: string } }) => {
          this.loadingMessages.set(false);
          this.error.set(err.error?.message ?? 'Browse failed');
        },
      });
  }

  async produce() {
    const ok = await this.confirm.ask({
      title: 'Produce message',
      message: `Write this record to ${this.name()}? Produce cannot be undone; the message stays in Kafka until retention expires.`,
      confirmLabel: 'Send',
    });
    if (!ok) {
      return;
    }
    this.producing.set(true);
    this.api
      .produce(this.id(), { topic: this.name(), key: this.produceKey, value: this.produceValue })
      .subscribe({
        next: () => {
          this.producing.set(false);
          this.loadMessages();
        },
        error: (err: { error?: { message?: string } }) => {
          this.producing.set(false);
          this.error.set(err.error?.message ?? 'Produce failed');
        },
      });
  }

  saveSearch() {
    const name = prompt('Search name', this.q || this.name());
    if (!name) {
      return;
    }
    this.api
      .saveSearch(this.id(), { name, topic: this.name(), q: this.q, jsonPath: this.jsonPath })
      .subscribe((search) => this.searches.update((items) => [...items, search]));
  }

  applySearch(search: SavedSearch) {
    this.q = search.q ?? '';
    this.jsonPath = search.jsonPath ?? '';
    this.loadMessages();
  }

  async remove() {
    const ok = await this.confirm.ask({
      title: 'Delete topic',
      message: `Delete ${this.name()} from Kafka? Partitions and retained messages are removed. This cannot be undone.`,
      confirmLabel: 'Delete topic',
      danger: true,
    });
    if (!ok) {
      return;
    }
    this.api.deleteTopic(this.id(), this.name()).subscribe(() => {
      void this.router.navigate(['/c', this.id(), 'topics']);
    });
  }
}
