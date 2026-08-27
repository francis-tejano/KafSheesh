import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { AuditEvent } from '@kafsheesh/shared';
import { map } from 'rxjs';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-audit',
  imports: [DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Audit</h1>
        <p>Mutating actions on this cluster stay visible for the team.</p>
      </div>
    </div>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>When</th><th>Action</th><th>Target</th><th>Result</th><th>Detail</th></tr></thead>
        <tbody>
          @for (event of events(); track event.id) {
            <tr>
              <td class="help">{{ event.at | date:'yyyy-MM-dd HH:mm:ss' }}</td>
              <td>{{ event.action }}</td>
              <td class="mono">{{ event.target }}</td>
              <td>
                <span class="pill" [class.ok]="event.ok" [class.err]="!event.ok">{{ event.ok ? 'ok' : 'failed' }}</span>
              </td>
              <td class="help">{{ event.detail }}</td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="help">No audited actions yet.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class AuditPage {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  readonly id = toSignal(
    this.route.parent!.paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: this.route.parent?.snapshot.paramMap.get('id') ?? '' },
  );
  readonly events = signal<AuditEvent[]>([]);

  constructor() {
    this.api.audit(this.id()).subscribe((events) => this.events.set(events));
  }
}
