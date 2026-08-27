import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { ConsumerGroupInfo } from '@kafsheesh/shared';
import { map } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ConfirmService } from '../../core/confirm.service';

@Component({
  selector: 'app-groups',
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1>Consumer groups</h1>
        <p>{{ groups().length }} groups. Offset resets stay on this page.</p>
      </div>
      <button class="btn ghost" (click)="load()" [disabled]="loading()">Refresh</button>
    </div>

    @if (error()) {
      <div class="banner">{{ error() }}</div>
    }
    @if (loading()) {
      <div class="card empty">Loading consumer groups…</div>
    }

    <div class="toolbar">
      <label>
        <span>Filter</span>
        <input [ngModel]="query()" (ngModelChange)="query.set($event)" name="gq" placeholder="group id…" />
      </label>
      <span class="help">{{ filtered().length }} shown</span>
    </div>

    <div class="card table-wrap">
      <table>
        <thead>
          <tr><th>Group</th><th>State</th><th>Members</th><th></th></tr>
        </thead>
        <tbody>
          @for (group of filtered(); track group.groupId) {
            <tr>
              <td class="mono">{{ group.groupId }}</td>
              <td><span class="pill" [class.ok]="group.state === 'Stable'">{{ group.state }}</span></td>
              <td>{{ group.members.length }}</td>
              <td>
                <button class="btn sm" (click)="selected.set(group); resetTopic = group.topics[0] || ''">Reset</button>
                <button class="btn sm danger" (click)="remove(group)">Delete</button>
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="4" class="help">{{ query() ? 'No groups match that filter.' : 'No consumer groups yet.' }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    @if (selected(); as group) {
      <form class="card" style="margin-top:16px" (ngSubmit)="reset(group)">
        <h3>Reset {{ group.groupId }}</h3>
        <p class="help">This moves committed offsets. Consumers must be idle or the broker may reject the request.</p>
        <label>
          <span>Topic</span>
          <select name="topic" [(ngModel)]="resetTopic">
            @for (topic of group.topics; track topic) {
              <option [value]="topic">{{ topic }}</option>
            }
          </select>
        </label>
        <label>
          <span>Strategy</span>
          <select name="strategy" [(ngModel)]="strategy">
            <option value="earliest">Earliest</option>
            <option value="latest">Latest</option>
          </select>
        </label>
        <div class="row">
          <button class="btn primary">Apply reset</button>
          <button type="button" class="btn ghost" (click)="selected.set(null)">Cancel</button>
        </div>
      </form>
    }
  `,
})
export class GroupsPage {
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly route = inject(ActivatedRoute);
  readonly id = toSignal(
    this.route.parent!.paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: this.route.parent?.snapshot.paramMap.get('id') ?? '' },
  );
  readonly groups = signal<ConsumerGroupInfo[]>([]);
  readonly selected = signal<ConsumerGroupInfo | null>(null);
  readonly error = signal('');
  readonly loading = signal(false);
  readonly query = signal('');
  readonly filtered = computed(() => {
    const q = this.query().toLowerCase();
    return this.groups().filter((group) => group.groupId.toLowerCase().includes(q));
  });
  resetTopic = '';
  strategy: 'earliest' | 'latest' = 'latest';

  constructor() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api.groups(this.id()).subscribe({
      next: (groups) => {
        this.groups.set(groups);
        this.loading.set(false);
      },
      error: (err: { error?: { message?: string } }) => {
        this.loading.set(false);
        this.error.set(err.error?.message ?? 'Failed to load groups');
      },
    });
  }

  async reset(group: ConsumerGroupInfo) {
    const topic = this.resetTopic || group.topics[0];
    if (!topic) {
      return;
    }
    const ok = await this.confirm.ask({
      title: 'Reset offsets',
      message: `Move committed offsets for ${group.groupId} on ${topic} to ${this.strategy}? Consumers may reprocess or skip messages. The group should be idle.`,
      confirmLabel: 'Reset offsets',
      danger: true,
    });
    if (!ok) {
      return;
    }
    this.api.resetOffsets(this.id(), { groupId: group.groupId, topic, strategy: this.strategy }).subscribe({
      next: () => {
        this.selected.set(null);
        this.load();
      },
      error: (err: { error?: { message?: string } }) =>
        this.error.set(err.error?.message ?? 'Reset failed'),
    });
  }

  async remove(group: ConsumerGroupInfo) {
    const ok = await this.confirm.ask({
      title: 'Delete consumer group',
      message: `Delete ${group.groupId}? Committed offsets for this group are discarded. Running members may fail until they rejoin.`,
      confirmLabel: 'Delete group',
      danger: true,
    });
    if (!ok) {
      return;
    }
    this.api.deleteGroup(this.id(), group.groupId).subscribe(() => this.load());
  }
}
