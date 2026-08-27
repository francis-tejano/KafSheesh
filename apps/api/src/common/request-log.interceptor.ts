import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { catchError, tap, throwError } from 'rxjs';
import { ActivityService } from '../activity/activity.service';

@Injectable()
export class RequestLogInterceptor implements NestInterceptor {
  constructor(private readonly activity: ActivityService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.originalUrl.startsWith('/api/activity') || req.originalUrl === '/api/health') {
      return next.handle();
    }
    const started = Date.now();
    const clusterId = this.clusterIdFrom(req.originalUrl);
    this.activity.info('HTTP', `→ ${req.method} ${req.originalUrl}`, clusterId);
    return next.handle().pipe(
      tap(() =>
        this.activity.info(
          'HTTP',
          `← ${req.method} ${req.originalUrl} ${Date.now() - started}ms`,
          clusterId,
        ),
      ),
      catchError((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.activity.error(
          'HTTP',
          `← ${req.method} ${req.originalUrl} failed after ${Date.now() - started}ms: ${message}`,
          clusterId,
        );
        return throwError(() => error);
      }),
    );
  }

  private clusterIdFrom(url: string): string | undefined {
    const match = url.match(/\/clusters\/([0-9a-f-]{36})/i);
    return match?.[1];
  }
}
