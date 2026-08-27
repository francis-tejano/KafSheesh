import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { ClusterOverview } from '@kafsheesh/shared';
import { catchError, map, of, switchMap } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ClusterSessionService } from '../../core/cluster-session.service';

@Component({
  selector: 'app-overview',
  imports: [RouterLink],
  template: `
    <div class="page-head">
      <div>
        <h1>Overview</h1>
        <p>Cluster metadata and the path Kafsheesh is using to reach it.</p>
      </div>
      <div class="row">
        <button class="btn primary" (click)="connect()" [disabled]="busy()">
          {{ busy() ? 'Connecting…' : 'Connect' }}
        </button>
        <button class="btn ghost" (click)="load()" [disabled]="loading()">Refresh</button>
      </div>
    </div>

    @if (error() && selected()) {
      <div class="banner">{{ error() }}</div>
    }

    @if (loading()) {
      <div class="card empty">Loading cluster metadata…</div>
    }

    @if (showConnectPrompt()) {
      <div class="card empty">
        <h3>Not connected</h3>
        <p>
          Connect {{ cluster()?.name ?? 'this cluster' }} to load brokers, topics, and groups
          through the tunnel if needed.
        </p>
        <button class="btn primary" (click)="connect()" [disabled]="busy()">
          {{ busy() ? 'Connecting…' : 'Connect now' }}
        </button>
      </div>
    }

    @if (overview(); as data) {
      <div class="grid stats">
        <div class="card stat">
          <div class="label">Brokers</div>
          <div class="value">{{ data.brokers.length }}</div>
        </div>
        <div class="card stat">
          <div class="label">Topics</div>
          <div class="value">{{ data.topicCount }}</div>
        </div>
        <div class="card stat">
          <div class="label">Under-replicated</div>
          <div class="value">{{ data.underReplicatedPartitions }}</div>
        </div>
        <div class="card stat">
          <div class="label">Consumer groups</div>
          <div class="value">{{ data.consumerGroupCount }}</div>
        </div>
      </div>

      <div class="grid two" style="margin-top:16px">
        <div class="card">
          <h3>Brokers</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Host</th><th>Role</th></tr></thead>
              <tbody>
                @for (broker of data.brokers; track broker.nodeId) {
                  <tr>
                    <td>{{ broker.nodeId }}</td>
                    <td class="mono">{{ broker.host }}:{{ broker.port }}</td>
                    <td>
                      @if (broker.isController) {
                        <span class="pill ok">controller</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <h3>Path</h3>
          @if (data.tunnel; as tunnel) {
            @if (tunnel.connected) {
              <p>Tunnel is up with {{ tunnel.forwards }} forward(s).</p>
              <p class="help">Round-trip {{ tunnel.latencyMs ?? '—' }}ms</p>
            } @else {
              <p>Tunnel configured but not connected.</p>
            }
          } @else {
            <p>Direct connection. No bastion hop.</p>
          }
          <p class="help">{{ cluster()?.name ?? data.clusterId }}</p>
          <div class="row" style="margin-top:12px">
            <a class="btn ghost" [routerLink]="['/c', id(), 'topics']">Browse topics</a>
            <a class="btn ghost" [routerLink]="['/c', id(), 'groups']">Consumer groups</a>
          </div>
        </div>
      </div>
    }
  `,
})
export class OverviewPage {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(ClusterSessionService);

  readonly id = toSignal(
    this.route.parent!.paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: this.route.parent?.snapshot.paramMap.get('id') ?? '' },
  );
  readonly cluster = toSignal(
    toObservable(this.id).pipe(
      switchMap((id) =>
        id ? this.api.getCluster(id).pipe(catchError(() => of(undefined))) : of(undefined),
      ),
    ),
  );
  readonly overview = signal<ClusterOverview | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly loading = signal(false);
  readonly selected = computed(() => {
    const current = this.cluster();
    return Boolean(current && current.id === this.id());
  });
  readonly showConnectPrompt = computed(() => {
    const current = this.cluster();
    return (
      this.selected() &&
      !this.loading() &&
      !this.overview() &&
      current?.runtime.status !== 'connected' &&
      current?.runtime.status !== 'connecting'
    );
  });

  constructor() {
    effect(() => {
      const id = this.id();
      this.session.revision();
      untracked(() => this.load(id));
    });
  }

  load(requested = this.id()) {
    if (!requested) {
      return;
    }
    this.error.set('');
    this.loading.set(true);
    this.api.overview(requested).subscribe({
      next: (data) => {
        if (requested !== this.id()) {
          return;
        }
        this.overview.set(data);
        this.loading.set(false);
      },
      error: (err: { error?: { message?: string } }) => {
        if (requested !== this.id()) {
          return;
        }
        this.loading.set(false);
        this.overview.set(null);
        const name = this.cluster()?.id === requested ? this.cluster()?.name : undefined;
        const fallback = name
          ? `${name} is not connected. Connect it first.`
          : 'Connect the cluster first.';
        this.error.set(err.error?.message ?? fallback);
      },
    });
  }

  connect() {
    const requested = this.id();
    const current = this.cluster();
    if (!requested || !current || current.id !== requested) {
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.api.connect(requested).subscribe({
      next: () => {
        this.busy.set(false);
        this.session.bump();
        this.load(requested);
      },
      error: (err: { error?: { message?: string } }) => {
        this.busy.set(false);
        this.error.set(err.error?.message ?? 'Connect failed');
      },
    });
  }
}
