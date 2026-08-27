import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { SchemaSubject } from '@kafsheesh/shared';
import { map } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ConfirmService } from '../../core/confirm.service';
import { FlagsService } from '../../core/flags.service';

@Component({
  selector: 'app-schemas',
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1>Schema Registry</h1>
        <p>Subjects from the registry attached to this cluster.</p>
      </div>
    </div>
    @if (error()) {
      <div class="banner">{{ error() }}</div>
    }
    @if (!flags.disableDestructive()) {
    <form class="card" style="margin-bottom:16px" (ngSubmit)="create()">
      <div class="grid two">
        <label><span>Subject</span><input name="subject" [(ngModel)]="subject" required /></label>
        <label>
          <span>Type</span>
          <select name="type" [(ngModel)]="schemaType">
            <option value="AVRO">AVRO</option>
            <option value="JSON">JSON</option>
            <option value="PROTOBUF">PROTOBUF</option>
          </select>
        </label>
      </div>
      <label><span>Schema</span><textarea name="schema" [(ngModel)]="schema" required></textarea></label>
      <button class="btn primary">Register</button>
    </form>
    }
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Subject</th><th>Version</th><th>Type</th><th>Schema</th><th></th></tr></thead>
        <tbody>
          @for (item of schemas(); track item.subject) {
            <tr>
              <td class="mono">{{ item.subject }}</td>
              <td>{{ item.latestVersion }}</td>
              <td>{{ item.schemaType }}</td>
              <td class="mono message-value">{{ item.schema }}</td>
              <td>
                @if (!flags.disableDestructive()) {
                  <button type="button" class="btn sm danger" (click)="remove(item)">Delete</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="help">No subjects yet, or Schema Registry is not configured.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class SchemasPage {
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  readonly flags = inject(FlagsService);
  private readonly route = inject(ActivatedRoute);
  readonly id = toSignal(
    this.route.parent!.paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: this.route.parent?.snapshot.paramMap.get('id') ?? '' },
  );
  readonly schemas = signal<SchemaSubject[]>([]);
  readonly error = signal('');
  subject = '';
  schemaType = 'AVRO';
  schema = '';

  constructor() {
    this.load();
  }

  load() {
    this.api.schemas(this.id()).subscribe({
      next: (schemas) => this.schemas.set(schemas),
      error: (err: { error?: { message?: string } }) =>
        this.error.set(err.error?.message ?? 'Schema Registry is not configured or unreachable'),
    });
  }

  async create() {
    const ok = await this.confirm.ask({
      title: 'Register schema',
      message: `Register a new ${this.schemaType} version for subject ${this.subject}? This writes to Schema Registry and cannot be undone by Kafsheesh.`,
      confirmLabel: 'Register',
    });
    if (!ok) {
      return;
    }
    this.api.createSchema(this.id(), {
      subject: this.subject,
      schema: this.schema,
      schemaType: this.schemaType,
    }).subscribe({
      next: () => {
        this.subject = '';
        this.schema = '';
        this.load();
      },
      error: (err: { error?: { message?: string } }) =>
        this.error.set(err.error?.message ?? 'Register failed'),
    });
  }

  async remove(item: SchemaSubject) {
    const ok = await this.confirm.ask({
      title: 'Delete schema subject',
      message: `Delete ${item.subject} and all of its versions from Schema Registry? Producers and consumers that depend on this subject may fail.`,
      confirmLabel: 'Delete subject',
      danger: true,
    });
    if (!ok) {
      return;
    }
    this.api.deleteSchema(this.id(), item.subject).subscribe({
      next: () => this.load(),
      error: (err: { error?: { message?: string } }) =>
        this.error.set(err.error?.message ?? 'Delete failed'),
    });
  }
}
