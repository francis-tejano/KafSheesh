import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-disclaimer',
  template: `
    <p class="disclaimer" [class.banner]="banner">
      Self-hosted only. Run Kafsheesh on a machine you control. SSH keys, Kafka credentials, and topic data stay in your environment — this is not a cloud or multi-tenant service.
      Author: <strong>Francis Tejano</strong>.
      Free software under the GNU GPL v3 or later; see LICENSE. This program comes with ABSOLUTELY NO WARRANTY.
    </p>
  `,
})
export class DisclaimerComponent {
  @Input() banner = false;
}
