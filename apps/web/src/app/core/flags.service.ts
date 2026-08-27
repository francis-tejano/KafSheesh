import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class FlagsService {
  private readonly api = inject(ApiService);
  readonly disableDestructive = signal(false);

  constructor() {
    this.api.health().subscribe({
      next: (health) => this.disableDestructive.set(health.flags.disableDestructive),
      error: () => undefined,
    });
  }
}
