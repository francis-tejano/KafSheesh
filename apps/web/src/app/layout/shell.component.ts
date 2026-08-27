import { Component, computed, HostListener, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import type { ClusterSummary } from '@kafsheesh/shared';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { ClusterSessionService } from '../core/cluster-session.service';
import { FlagsService } from '../core/flags.service';
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
            <div class="cluster-picker" [class.open]="pickerOpen()">
              <button
                type="button"
                class="cluster-picker-trigger"
                [attr.aria-expanded]="pickerOpen()"
                aria-haspopup="listbox"
                (click)="togglePicker(); $event.stopPropagation()"
              >
                <span class="cluster-picker-name">{{ current.name }}</span>
                <span class="cluster-picker-caret" aria-hidden="true">▾</span>
              </button>
              @if (pickerOpen()) {
                <ul class="cluster-picker-menu" role="listbox" (click)="$event.stopPropagation()">
                  @for (item of clusters(); track item.id) {
                    <li>
                      <button
                        type="button"
                        class="cluster-picker-option"
                        role="option"
                        [class.active]="item.id === current.id"
                        [attr.aria-selected]="item.id === current.id"
                        (click)="chooseCluster(item.id)"
                      >
                        <span>{{ item.name }}</span>
                        <span
                          class="pill"
                          [class.ok]="item.runtime.status === 'connected'"
                          [class.warn]="item.runtime.status === 'connecting'"
                          [class.err]="item.runtime.status === 'error' || item.runtime.status === 'disconnected'"
                        >
                          {{ item.runtime.status }}
                        </span>
                      </button>
                    </li>
                  }
                </ul>
              }
            </div>
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
        @if (flags.disableDestructive()) {
          <div class="banner warn">Destructive actions are disabled on this instance.</div>
        }
        <router-outlet />
      </main>
    </div>
  `,
})
export class ShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  private readonly session = inject(ClusterSessionService);
  readonly flags = inject(FlagsService);
  readonly clusters = signal<ClusterSummary[]>([]);
  readonly busy = signal(false);
  readonly pickerOpen = signal(false);
  private readonly reloadAt = signal(0);

  readonly id = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: this.route.snapshot.paramMap.get('id') ?? '' },
  );

  readonly cluster = toSignal(
    combineLatest([this.route.paramMap, toObservable(this.reloadAt), toObservable(this.session.revision)]).pipe(
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

  @HostListener('document:click')
  closePicker() {
    this.pickerOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.pickerOpen.set(false);
  }

  togglePicker() {
    this.pickerOpen.update((open) => !open);
  }

  chooseCluster(next: string) {
    this.pickerOpen.set(false);
    if (next === this.id()) {
      return;
    }
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
        this.session.bump();
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
