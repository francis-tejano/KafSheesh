import { Controller, Get, MessageEvent, Sse } from '@nestjs/common';
import { Observable, map, startWith } from 'rxjs';
import { ActivityService } from './activity.service';

@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  list() {
    return this.activity.recent();
  }

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return this.activity.stream().pipe(
      startWith(...this.activity.recent()),
      map((event) => ({ data: event })),
    );
  }
}
