import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ClusterRuntime, ClusterSummary } from '@kafsheesh/shared';
import { ApiService } from '../../core/api.service';
import { ConfirmService } from '../../core/confirm.service';
import { FlagsService } from '../../core/flags.service';
import { BrandComponent } from '../../layout/brand.component';

@Component({
  selector: 'app-clusters',
  imports: [RouterLink, BrandComponent],
  template: `
    <div class="content">
      <div class="page-head">
        <div>
          <app-brand size="lg" />
          <p style="margin-top:10px">Connect directly, or hop through a bastion when Kafka lives behind the wall.</p>
        </div>
        <a class="btn primary" routerLink="/clusters/new">Add cluster</a>
      </div>

      @if (flags.disableDestructive()) {
        <div class="banner warn">Destructive actions are disabled on this instance.</div>
      }
      @if (error()) {
        <div class="banner">{{ error() }}</div>
      }

      @if (!clusters().length && !error()) {
        <div class="card empty">
          <h3>No clusters yet</h3>
          <p>Add a direct Kafka cluster or a tunneled one (bastion → Kafka).</p>
          <a class="btn primary" routerLink="/clusters/new">Create the first cluster</a>
        </div>
      } @else {
        <div class="grid cards">
          @for (cluster of clusters(); track cluster.id) {
            <article class="card cluster-card">
              <header class="cluster-card-head">
                <h3>{{ cluster.name }}</h3>
                <span class="pill"
                  [class.ok]="cluster.runtime.status === 'connected'"
                  [class.warn]="cluster.runtime.status === 'connecting'"
                  [class.err]="cluster.runtime.status === 'error' || cluster.runtime.status === 'disconnected'">
                  {{ cluster.runtime.status }}
                </span>
              </header>
              <dl class="cluster-meta">
                <div>
                  <dt>Brokers</dt>
                  <dd class="mono">{{ cluster.brokers.join(', ') }}</dd>
                </div>
                <div>
                  <dt>Path</dt>
                  <dd class="mono">
                    @if (cluster.tunnel?.enabled) {
                      {{ cluster.tunnel?.host }}:{{ cluster.tunnel?.port }}
                    } @else {
                      direct
                    }
                  </dd>
                </div>
              </dl>
              <div class="cluster-tags">
                <span class="pill" [class.warn]="!!cluster.tunnel?.enabled">
                  {{ cluster.tunnel?.enabled ? 'tunnel' : 'direct' }}
                </span>
                @if (cluster.ssl) {
                  <span class="pill">tls</span>
                }
                @if (cluster.sasl) {
                  <span class="pill">{{ cluster.sasl.mechanism }}</span>
                }
              </div>
              @if (cluster.runtime.lastError) {
                <p class="cluster-error">{{ cluster.runtime.lastError }}</p>
              }
              <div class="cluster-actions">
                @if (cluster.runtime.status === 'connected') {
                  <a class="btn primary" [routerLink]="['/c', cluster.id, 'overview']">Open</a>
                  <button class="btn ghost" (click)="disconnect(cluster)">Disconnect</button>
                } @else {
                  <button class="btn primary" (click)="connect(cluster)" [disabled]="isBusy(cluster.id)">
                    {{ isBusy(cluster.id) ? 'Connecting…' : 'Connect' }}
                  </button>
                  <a class="btn ghost" [routerLink]="['/c', cluster.id, 'overview']">Open</a>
                }
                <a class="btn ghost" [routerLink]="['/clusters', cluster.id, 'edit']">Edit</a>
                <button class="btn ghost" (click)="duplicate(cluster)" [disabled]="isBusy(cluster.id)">
                  Duplicate
                </button>
                @if (!flags.disableDestructive()) {
                  <button class="btn danger" (click)="remove(cluster)">Delete</button>
                }
              </div>
            </article>
          }
        </div>
      }
    </div>
  `,
})
export class ClustersPage {
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  readonly flags = inject(FlagsService);
  readonly clusters = signal<ClusterSummary[]>([]);
  readonly error = signal('');
  readonly busy = signal<ReadonlySet<string>>(new Set());
  private listToken = 0;

  constructor() {
    this.reload();
  }

  isBusy(id: string): boolean {
    return this.busy().has(id);
  }

  private setBusy(id: string, on: boolean) {
    this.busy.update((current) => {
      const next = new Set(current);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  private patchRuntime(id: string, runtime: Partial<ClusterRuntime>) {
    this.clusters.update((clusters) =>
      clusters.map((cluster) =>
        cluster.id === id
          ? { ...cluster, runtime: { ...cluster.runtime, ...runtime, id } }
          : cluster,
      ),
    );
  }

  reload() {
    const token = ++this.listToken;
    this.api.listClusters().subscribe({
      next: (clusters) => {
        if (token !== this.listToken) {
          return;
        }
        const busy = this.busy();
        this.clusters.set(
          clusters.map((cluster) => {
            if (!busy.has(cluster.id)) {
              return cluster;
            }
            const current = this.clusters().find((item) => item.id === cluster.id);
            return current ?? cluster;
          }),
        );
      },
      error: (err: { error?: { message?: string } }) =>
        this.error.set(err.error?.message ?? 'API is not reachable. Start the NestJS server on :4000.'),
    });
  }

  connect(cluster: ClusterSummary) {
    this.setBusy(cluster.id, true);
    this.error.set('');
    this.patchRuntime(cluster.id, { status: 'connecting', lastError: undefined });
    this.api.connect(cluster.id).subscribe({
      next: (runtime) => {
        this.patchRuntime(cluster.id, runtime);
        this.setBusy(cluster.id, false);
      },
      error: (err: { error?: { message?: string } }) => {
        this.setBusy(cluster.id, false);
        this.patchRuntime(cluster.id, {
          status: 'error',
          lastError: err.error?.message ?? 'Connect failed',
        });
        this.error.set(err.error?.message ?? 'Connect failed');
      },
    });
  }

  async duplicate(cluster: ClusterSummary) {
    const ok = await this.confirm.ask({
      title: 'Duplicate cluster',
      message: `Create a copy of ${cluster.name}? Brokers, tunnel, and stored credentials are copied. The new cluster starts disconnected.`,
      confirmLabel: 'Duplicate',
    });
    if (!ok) {
      return;
    }
    this.setBusy(cluster.id, true);
    this.error.set('');
    this.api.duplicateCluster(cluster.id).subscribe({
      next: () => {
        this.setBusy(cluster.id, false);
        this.reload();
      },
      error: (err: { error?: { message?: string } }) => {
        this.setBusy(cluster.id, false);
        this.error.set(err.error?.message ?? 'Duplicate failed');
      },
    });
  }

  async disconnect(cluster: ClusterSummary) {
    const ok = await this.confirm.ask({
      title: 'Disconnect cluster',
      message: `Close the live session for ${cluster.name}? The tunnel (if any) will drop. Kafka data is not deleted.`,
      confirmLabel: 'Disconnect',
    });
    if (!ok) {
      return;
    }
    this.setBusy(cluster.id, true);
    this.api.disconnect(cluster.id).subscribe({
      next: (runtime) => {
        this.patchRuntime(cluster.id, runtime);
        this.setBusy(cluster.id, false);
      },
      error: () => this.setBusy(cluster.id, false),
    });
  }

  async remove(cluster: ClusterSummary) {
    const ok = await this.confirm.ask({
      title: 'Delete cluster',
      message: `Remove ${cluster.name} from Kafsheesh? This deletes the saved connection only, not Kafka topics or data.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) {
      return;
    }
    this.api.deleteCluster(cluster.id).subscribe(() => this.reload());
  }
}
