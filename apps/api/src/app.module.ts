import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActivityController } from './activity/activity.controller';
import { ActivityService } from './activity/activity.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditService } from './audit/audit.service';
import { RequestLogInterceptor } from './common/request-log.interceptor';
import {
  AuditController,
  ClusterResourcesController,
  ClustersController,
} from './clusters/clusters.controller';
import { ClustersService } from './clusters/clusters.service';
import { KafkaManagerService } from './kafka/kafka-manager.service';
import { JsonStoreService } from './store/json-store.service';
import { SshTunnelService } from './tunnel/ssh-tunnel.service';

@Module({
  imports: [],
  controllers: [
    AppController,
    ClustersController,
    ClusterResourcesController,
    AuditController,
    ActivityController,
  ],
  providers: [
    AppService,
    JsonStoreService,
    AuditService,
    ActivityService,
    SshTunnelService,
    KafkaManagerService,
    ClustersService,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLogInterceptor,
    },
  ],
})
export class AppModule {}
