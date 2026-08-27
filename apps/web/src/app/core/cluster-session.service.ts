import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ClusterSessionService {
  readonly revision = signal(0);

  bump() {
    this.revision.update((value) => value + 1);
  }
}
