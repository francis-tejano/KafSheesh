import { DatePipe } from '@angular/common';
import {
  afterRenderEffect,
  Component,
  ElementRef,
  HostListener,
  inject,
  viewChild,
} from '@angular/core';
import { ActivityFeedService } from '../core/activity.service';
import { ConfirmService } from '../core/confirm.service';
import { DisclaimerComponent } from './disclaimer.component';

@Component({
  selector: 'app-activity-log',
  imports: [DatePipe, DisclaimerComponent],
  template: `
    <section class="activity-dock" [class.collapsed]="!feed.open()">
      <aside class="activity-legal">
        <app-disclaimer />
      </aside>
      <div class="activity-main">
        <header class="activity-head">
          <div class="row">
            <strong>Activity</strong>
            <span class="pill" [class.ok]="feed.connected()" [class.err]="!feed.connected()">
              {{ feed.connected() ? 'live' : 'reconnecting' }}
            </span>
            @if (feed.issueCount()) {
              <span class="pill err">{{ feed.issueCount() }} issues</span>
            }
            @if (feed.unseen()) {
              <span class="pill warn">{{ feed.unseen() }} new</span>
            }
            @if (!feed.open() && feed.latest(); as last) {
              <span class="activity-preview" [class.err]="last.level === 'error'">
                {{ last.at | date:'HH:mm:ss' }} {{ last.message }}
              </span>
            }
          </div>
          <div class="row">
            @if (feed.open()) {
              <button type="button" class="pill btnish" [class.active]="feed.filter() === 'all'" (click)="feed.setFilter('all')">All</button>
              <button type="button" class="pill btnish" [class.active]="feed.filter() === 'issues'" (click)="feed.setFilter('issues')">Issues</button>
              <button type="button" class="btn sm ghost" (click)="clear()">Clear</button>
            }
            <button type="button" class="btn sm" (click)="feed.toggle()">
              {{ feed.open() ? 'Hide' : 'Show' }}
            </button>
          </div>
        </header>
        @if (feed.open()) {
          <div class="activity-pane">
            <div class="activity-body" #scroller (scroll)="onScroll()">
              @for (event of feed.visible(); track event.id) {
                <div class="activity-line" [class.err]="event.level === 'error'" [class.warn]="event.level === 'warn'">
                  <span class="activity-time">{{ event.at | date:'HH:mm:ss' }}</span>
                  <span class="activity-src">{{ event.source }}</span>
                  <span class="activity-msg">{{ event.message }}</span>
                </div>
              } @empty {
                <div class="help">{{ feed.filter() === 'issues' ? 'No warnings or errors yet.' : 'Waiting for activity… connect a cluster or open a page.' }}</div>
              }
            </div>
            @if (!feed.following() && feed.unseen()) {
              <button type="button" class="btn sm primary activity-jump" (click)="resumeFollow()">
                Jump to latest ({{ feed.unseen() }})
              </button>
            }
          </div>
        }
      </div>
    </section>
  `,
})
export class ActivityLogComponent {
  readonly feed = inject(ActivityFeedService);
  private readonly confirm = inject(ConfirmService);
  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');

  constructor() {
    afterRenderEffect(() => {
      this.feed.visible();
      this.feed.open();
      this.feed.following();
      if (this.feed.open() && this.feed.following()) {
        this.jumpToLatest();
      }
    });
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event) {
    if (this.confirm.request()) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
      return;
    }
    if (this.feed.open()) {
      this.feed.toggle();
    }
  }

  async clear() {
    const ok = await this.confirm.ask({
      title: 'Clear activity',
      message: 'This removes the current activity feed from this browser session. It does not change Kafka.',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (ok) {
      this.feed.clear();
    }
  }

  onScroll() {
    const scroller = this.scroller()?.nativeElement;
    if (!scroller) {
      return;
    }
    const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    this.feed.following.set(gap < 32);
    if (gap < 32) {
      this.feed.markSeen();
    }
  }

  resumeFollow() {
    this.feed.following.set(true);
    this.feed.markSeen();
    this.jumpToLatest();
  }

  jumpToLatest() {
    const scroller = this.scroller()?.nativeElement;
    if (!scroller) {
      return;
    }
    scroller.scrollTop = scroller.scrollHeight;
  }
}
