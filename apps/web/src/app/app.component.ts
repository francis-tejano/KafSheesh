import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ActivityFeedService } from './core/activity.service';
import { ActivityLogComponent } from './layout/activity-log.component';
import { ConfirmDialogComponent } from './layout/confirm-dialog.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ActivityLogComponent, ConfirmDialogComponent],
  template: `
    <div class="app-frame" [class.dock-open]="feed.open()">
      <router-outlet />
      <app-activity-log />
      <app-confirm-dialog />
    </div>
  `,
})
export class AppComponent {
  readonly feed = inject(ActivityFeedService);
}
