import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { ConsumerGroupInfo } from '@kafsheesh/shared';
import { map } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ConfirmService } from '../../core/confirm.service';
import { FlagsService } from '../../core/flags.service';
import { FROM_TOPIC_PARAM, listFilterNavExtras, persistListFilter } from '../../core/list-filter';

function groupKind(state: string): 'stable' | 'rebalancing' | 'empty' | 'dead' | 'other' {
  const normalized = (state || '').trim().toLowerCase();
  if (normalized === 'stable') {
    return 'stable';
  }
  if (normalized.includes('rebalance')) {
    return 'rebalancing';
  }
  if (normalized === 'empty') {
    return 'empty';
  }
  if (normalized === 'dead') {
    return 'dead';
  }
  return 'other';
}

@Component({
  selector: 'app-groups',
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1>{{ groupId() ? 'Consumer group' : 'Consumer groups' }}</h1>
        <p>
          @if (groupId()) {
            Reset offsets and inspect members.
          } @else {
            {{ groups().length }} groups. Open a group to reset offsets.
          }
        </p>
      </div>
      <div class="row">
        @if (groupId()) {
          <button type="button" class="btn ghost" (click)="backToList()">Back</button>
        }
        <button class="btn ghost" (click)="load()" [disabled]="loading()">Refresh</button>
      </div>
    </div>

    @if (error()) {
      <div class="banner">{{ error() }}</div>
    }
    @if (loading()) {
      <div class="card empty">Loading consumer groups…</div>
    }

    @if (!groupId()) {
      <div class="grid stats thirds" style="margin-bottom:16px">
        <div class="card stat clickable" [class.active]="status() === 'all'" (click)="setStatus('all')">
          <div class="label">Groups</div>
          <div class="value" [class.pending]="loading()">{{ loading() ? 'Fetching…' : summary().total.toLocaleString() }}</div>
        </div>
        <div
          class="card stat clickable"
          [class.active]="status() === 'stable'"
          [class.tone-ok]="summary().stable > 0"
          (click)="setStatus('stable')"
        >
          <div class="label">Stable</div>
          <div class="value" [class.pending]="loading()">{{ loading() ? 'Fetching…' : summary().stable.toLocaleString() }}</div>
        </div>
        <div
          class="card stat clickable"
          [class.active]="status() === 'rebalancing'"
          [class.tone-warn]="summary().rebalancing > 0"
          (click)="setStatus('rebalancing')"
        >
          <div class="label">Rebalancing</div>
          <div class="value" [class.pending]="loading()">{{ loading() ? 'Fetching…' : summary().rebalancing.toLocaleString() }}</div>
          <div class="hint">Preparing or completing rebalance</div>
        </div>
        <div
          class="card stat clickable"
          [class.active]="status() === 'empty'"
          [class.tone-warn]="summary().empty > 0"
          (click)="setStatus('empty')"
        >
          <div class="label">Empty</div>
          <div class="value" [class.pending]="loading()">{{ loading() ? 'Fetching…' : summary().empty.toLocaleString() }}</div>
          <div class="hint">No members</div>
        </div>
        <div
          class="card stat clickable"
          [class.active]="status() === 'dead'"
          [class.tone-err]="summary().dead > 0"
          (click)="setStatus('dead')"
        >
          <div class="label">Dead</div>
          <div class="value" [class.pending]="loading()">{{ loading() ? 'Fetching…' : summary().dead.toLocaleString() }}</div>
          <div class="hint">Group marked dead</div>
        </div>
        <div
          class="card stat clickable"
          [class.active]="status() === 'lag'"
          [class.tone-warn]="summary().lag > 0"
          (click)="setStatus('lag')"
        >
          <div class="label">Lag</div>
          <div class="value" [class.pending]="loading()">{{ loading() ? 'Fetching…' : summary().lag.toLocaleString() }}</div>
          <div class="hint">Across all groups</div>
        </div>
      </div>

      <div class="toolbar">
        <label>
          <span>Filter</span>
          <input [ngModel]="query()" (ngModelChange)="setQuery($event)" name="gq" placeholder="group id…" />
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
              <tr class="clickable" (click)="open(group.groupId)">
                <td class="mono">{{ group.groupId }}</td>
                <td>
                  <span
                    class="pill"
                    [class.ok]="groupKind(group.state) === 'stable'"
                    [class.warn]="groupKind(group.state) === 'rebalancing' || groupKind(group.state) === 'empty'"
                    [class.err]="groupKind(group.state) === 'dead'"
                  >{{ group.state || '—' }}</span>
                </td>
                <td>{{ group.members.length }}</td>
                <td>
                  @if (!flags.disableDestructive()) {
                    <button class="btn sm danger" (click)="remove(group, $event)">Delete</button>
                  }
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
    }

    @if (groupId() && currentGroup(); as group) {
      <div class="grid stats">
        <div class="card stat"><div class="label">State</div><div class="value">{{ group.state || '—' }}</div></div>
        <div class="card stat"><div class="label">Members</div><div class="value">{{ group.members.length }}</div></div>
        <div class="card stat"><div class="label">Lag</div><div class="value">{{ group.lag.toLocaleString() }}</div></div>
        <div class="card stat"><div class="label">Topics</div><div class="value">{{ group.topics.length }}</div></div>
      </div>

      @if (group.members.length) {
        <div class="card table-wrap" style="margin-top:16px">
          <h3>Members</h3>
          <table>
            <thead><tr><th>Member</th><th>Client</th><th>Host</th><th>Assignments</th></tr></thead>
            <tbody>
              @for (member of group.members; track member.memberId) {
                <tr>
                  <td class="mono">{{ member.memberId }}</td>
                  <td class="mono">{{ member.clientId }}</td>
                  <td class="mono">{{ member.clientHost }}</td>
                  <td>{{ assignmentLabel(member.assignments) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (!flags.disableDestructive()) {
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
          <button type="button" class="btn danger" (click)="remove(group)">Delete group</button>
        </div>
      </form>
      }
    } @else if (groupId() && !loading()) {
      <div class="card empty">That consumer group was not found.</div>
    }
  `,
})
export class GroupsPage {
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  readonly flags = inject(FlagsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly id = toSignal(
    this.route.parent!.paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: this.route.parent?.snapshot.paramMap.get('id') ?? '' },
  );
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly groupId = computed(() => this.params().get('groupId') ?? '');
  readonly query = computed(() => this.queryParams().get('filter') ?? '');
  readonly status = signal<'all' | 'stable' | 'rebalancing' | 'empty' | 'dead' | 'lag'>('all');
  readonly groups = signal<ConsumerGroupInfo[]>([]);
  readonly error = signal('');
  readonly loading = signal(false);
  readonly summary = computed(() => {
    let stable = 0;
    let rebalancing = 0;
    let empty = 0;
    let dead = 0;
    let lag = 0;
    for (const group of this.groups()) {
      const kind = groupKind(group.state);
      if (kind === 'stable') {
        stable += 1;
      } else if (kind === 'rebalancing') {
        rebalancing += 1;
      } else if (kind === 'empty') {
        empty += 1;
      } else if (kind === 'dead') {
        dead += 1;
      }
      lag += group.lag;
    }
    return { total: this.groups().length, stable, rebalancing, empty, dead, lag };
  });
  readonly filtered = computed(() => {
    const q = this.query().toLowerCase();
    const status = this.status();
    return this.groups().filter((group) => {
      if (q && !group.groupId.toLowerCase().includes(q)) {
        return false;
      }
      if (status === 'lag') {
        return group.lag > 0;
      }
      if (status !== 'all' && groupKind(group.state) !== status) {
        return false;
      }
      return true;
    });
  });
  readonly currentGroup = computed(() => {
    const groupId = this.groupId();
    return this.groups().find((group) => group.groupId === groupId) ?? null;
  });
  resetTopic = '';
  strategy: 'earliest' | 'latest' = 'latest';

  constructor() {
    effect(() => {
      const group = this.currentGroup();
      this.resetTopic = group?.topics[0] || '';
    });
    this.load();
  }

  setQuery(value: string) {
    persistListFilter(this.router, this.route, value);
  }

  setStatus(next: 'all' | 'stable' | 'rebalancing' | 'empty' | 'dead' | 'lag') {
    this.status.update((current) => (next === 'all' || current === next ? 'all' : next));
  }

  groupKind(state: string): 'stable' | 'rebalancing' | 'empty' | 'dead' | 'other' {
    return groupKind(state);
  }

  open(groupId: string) {
    void this.router.navigate(['/c', this.id(), 'groups', groupId], listFilterNavExtras(this.query()));
  }

  backToList() {
    const fromTopic = this.queryParams().get(FROM_TOPIC_PARAM);
    if (fromTopic) {
      void this.router.navigate(['/c', this.id(), 'topics', fromTopic], listFilterNavExtras(this.query()));
      return;
    }
    void this.router.navigate(['/c', this.id(), 'groups'], listFilterNavExtras(this.query()));
  }

  assignmentLabel(assignments: ConsumerGroupInfo['members'][number]['assignments']): string {
    if (!assignments.length) {
      return '—';
    }
    return assignments
      .map((assignment) => `${assignment.topic}[${assignment.partitions.join(',')}]`)
      .join(', ');
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
      next: () => this.load(),
      error: (err: { error?: { message?: string } }) =>
        this.error.set(err.error?.message ?? 'Reset failed'),
    });
  }

  async remove(group: ConsumerGroupInfo, event?: Event) {
    event?.stopPropagation();
    const ok = await this.confirm.ask({
      title: 'Delete consumer group',
      message: `Delete ${group.groupId}? Committed offsets for this group are discarded. Running members may fail until they rejoin.`,
      confirmLabel: 'Delete group',
      danger: true,
    });
    if (!ok) {
      return;
    }
    this.api.deleteGroup(this.id(), group.groupId).subscribe(() => {
      if (this.groupId()) {
        this.backToList();
        return;
      }
      this.load();
    });
  }
}
