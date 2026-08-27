import { Component, DestroyRef, inject } from '@angular/core';
import { ConfirmService } from '../core/confirm.service';

@Component({
  selector: 'app-confirm-dialog',
  template: `
    @if (confirm.request(); as req) {
      <div class="modal-backdrop" (click)="confirm.settle(false)">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" (click)="$event.stopPropagation()">
          <h2 id="confirm-title">{{ req.title }}</h2>
          <p>{{ req.message }}</p>
          <div class="row modal-actions">
            <button type="button" class="btn ghost" [attr.autofocus]="req.danger ? '' : null" (click)="confirm.settle(false)">
              {{ req.cancelLabel || 'Cancel' }}
            </button>
            <button
              type="button"
              class="btn"
              [class.danger]="req.danger"
              [class.primary]="!req.danger"
              [attr.autofocus]="req.danger ? null : ''"
              (click)="confirm.settle(true)"
            >
              {{ req.confirmLabel || 'Continue' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmDialogComponent {
  readonly confirm = inject(ConfirmService);

  constructor() {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !this.confirm.request()) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      this.confirm.settle(false);
    };
    document.addEventListener('keydown', onKey, true);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('keydown', onKey, true));
  }
}
