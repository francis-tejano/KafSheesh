import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import type { ClusterSummary } from '@kafsheesh/shared';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { BrandComponent } from './brand.component';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, BrandComponent],
  template: `
    <div class="app-shell">
      <aside class="sidebar">
        <app-brand />

        @if (cluster(); as current) {
          <div class="cluster-switch">
            <div class="field-label">Cluster</div>
            <select class="cluster-select" [value]="current.id" (change)="switchCluster($event)">
              @for (item of clusters(); track item.id) {
                <option [value]="item.id">{{ item.name }}</option>
              }
            </select>
            <div class="row" style="margin-top:8px">
              <span class="pill"
                [class.ok]="current.runtime.status === 'connected'"
                [class.warn]="current.runtime.status === 'connecting'"
                [class.err]="current.runtime.status === 'error' || current.runtime.status === 'disconnected'">
                {{ current.runtime.status }}
              </span>
              @if (current.tunnel?.enabled) {
                <span class="pill warn">tunnel</span>
              }
            </div>
            @if (current.runtime.status !== 'connected' && current.runtime.status !== 'connecting') {
              <button class="btn sm primary" style="margin-top:10px;width:100%" (click)="connect()" [disabled]="busy()">
                {{ busy() ? 'Connecting…' : 'Connect' }}
              </button>
            }
          </div>
        }

        <nav class="nav-group">
          @for (item of links(); track item.path) {
            <a class="nav-link" [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{exact: item.exact}">
              <span>{{ item.label }}</span>
            </a>
          }
        </nav>

        <div style="margin-top:auto" class="nav-group">
          <a class="nav-link" routerLink="/clusters">All clusters</a>
        </div>
      </aside>
      <main class="content">
        <router-outlet />
      </main>
    </div>
  `,
})
export class ShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  readonly clusters = signal<ClusterSummary[]>([]);
  readonly busy = signal(false);
  private readonly reloadAt = signal(0);

  readonly id = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: this.route.snapshot.paramMap.get('id') ?? '' },
  );

  readonly cluster = toSignal(
    combineLatest([this.route.paramMap, toObservable(this.reloadAt)]).pipe(
      map(([params]) => params.get('id') ?? ''),
      switchMap((id) => this.api.getCluster(id).pipe(catchError(() => of(undefined)))),
    ),
  );

  readonly links = computed(() => {
    const id = this.id();
    return [
      { path: `/c/${id}/overview`, label: 'Overview', exact: true },
      { path: `/c/${id}/topics`, label: 'Topics', exact: false },
      { path: `/c/${id}/groups`, label: 'Consumer groups', exact: false },
      { path: `/c/${id}/brokers`, label: 'Brokers', exact: false },
      { path: `/c/${id}/schemas`, label: 'Schemas', exact: false },
      { path: `/c/${id}/audit`, label: 'Audit', exact: false },
    ];
  });

  constructor() {
    this.loadClusters();
  }

  switchCluster(event: Event) {
    const next = (event.target as HTMLSelectElement).value;
    const section = this.router.url.split('/')[3] || 'overview';
    void this.router.navigate(['/c', next, section === 'topics' ? 'topics' : section]);
  }

  connect() {
    const id = this.id();
    if (!id) {
      return;
    }
    this.busy.set(true);
    this.api.connect(id).subscribe({
      next: () => {
        this.busy.set(false);
        this.reloadAt.update((value) => value + 1);
        this.loadClusters();
      },
      error: () => this.busy.set(false),
    });
  }

  private loadClusters() {
    this.api.listClusters().subscribe({
      next: (clusters) => this.clusters.set(clusters),
      error: () => undefined,
    });
  }
}
