import { Injectable } from '@nestjs/common';
import type { HealthInfo } from '@kafsheesh/shared';
import { appFlags } from './common/flags';

@Injectable()
export class AppService {
  health(): HealthInfo {
    return {
      name: 'kafsheesh',
      status: 'ok',
      time: new Date().toISOString(),
      flags: appFlags(),
    };
  }
}
