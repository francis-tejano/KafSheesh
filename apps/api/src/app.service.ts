import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health() {
    return {
      name: 'kafsheesh',
      status: 'ok',
      time: new Date().toISOString(),
    };
  }
}
