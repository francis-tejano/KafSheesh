import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-brand',
  imports: [RouterLink],
  template: `
    <a class="brand" [class.brand-lg]="size() === 'lg'" routerLink="/clusters">
      <span class="brand-mark" aria-hidden="true">
        <img src="/logo-192.png" width="72" height="72" alt="" />
      </span>
      <span class="brand-copy">
        <strong>Kafsheesh</strong>
        @if (tagline()) {
          <small>Kafka through any wall</small>
        }
      </span>
    </a>
  `,
})
export class BrandComponent {
  readonly tagline = input(true);
  readonly size = input<'sm' | 'lg'>('sm');
}
