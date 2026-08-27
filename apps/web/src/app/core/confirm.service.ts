import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly request = signal<ConfirmOptions | null>(null);
  private resolve?: (ok: boolean) => void;

  ask(options: ConfirmOptions): Promise<boolean> {
    this.resolve?.(false);
    this.request.set(options);
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  settle(ok: boolean) {
    this.request.set(null);
    this.resolve?.(ok);
    this.resolve = undefined;
  }
}
