import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { BrokerInfo } from '@kafsheesh/shared';
import { map } from 'rxjs';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-brokers',
  imports: [],
  template: `
    <div class="page-head">
      <div>
        <h1>Brokers</h1>
        <p>Advertised hosts as Kafka reports them. Tunneled clusters remap these under the hood.</p>
      </div>
    </div>
    @if (error()) {
      <div class="banner">{{ error() }}</div>
    }
    @if (loading()) {
      <div class="card empty">Loading brokers…</div>
    }
    <div class="card table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Advertised</th><th>Rack</th><th></th></tr></thead>
        <tbody>
          @for (broker of brokers(); track broker.nodeId) {
            <tr>
              <td>{{ broker.nodeId }}</td>
              <td class="mono">{{ broker.host }}:{{ broker.port }}</td>
              <td>{{ broker.rack || '—' }}</td>
              <td>
                @if (broker.isController) {
                  <span class="pill ok">controller</span>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="4" class="help">{{ loading() ? '' : 'No brokers loaded. Connect the cluster first.' }}</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class BrokersPage {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  readonly id = toSignal(
    this.route.parent!.paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: this.route.parent?.snapshot.paramMap.get('id') ?? '' },
  );
  readonly brokers = signal<BrokerInfo[]>([]);
  readonly error = signal('');
  readonly loading = signal(true);

  constructor() {
    this.api.brokers(this.id()).subscribe({
      next: (brokers) => {
        this.brokers.set(brokers);
        this.loading.set(false);
      },
      error: (err: { error?: { message?: string } }) => {
        this.loading.set(false);
        this.error.set(err.error?.message ?? 'Failed to load brokers');
      },
    });
  }
}
