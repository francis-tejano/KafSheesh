import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { KafkaManagerService } from '../kafka/kafka-manager.service';
import {
  CreateClusterDto,
  CreateSchemaDto,
  CreateTopicDto,
  ProduceMessageDto,
  ResetOffsetsDto,
  SavedSearchDto,
  UpdateClusterDto,
} from './cluster.dto';
import { ClustersService } from './clusters.service';

@Controller('clusters')
export class ClustersController {
  constructor(private readonly clusters: ClustersService) {}

  @Get()
  list() {
    return this.clusters.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.clusters.get(id);
  }

  @Post()
  create(@Body() body: CreateClusterDto) {
    return this.clusters.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: UpdateClusterDto) {
    return this.clusters.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.clusters.remove(id);
  }

  @Post(':id/connect')
  connect(@Param('id') id: string) {
    return this.clusters.connect(id);
  }

  @Post(':id/disconnect')
  disconnect(@Param('id') id: string) {
    return this.clusters.disconnect(id);
  }

  @Post(':id/diagnose')
  diagnose(@Param('id') id: string) {
    return this.clusters.diagnose(id);
  }
}

@Controller('clusters/:id')
export class ClusterResourcesController {
  constructor(
    private readonly kafka: KafkaManagerService,
    private readonly clusters: ClustersService,
    private readonly audit: AuditService,
  ) {}

  @Get('overview')
  overview(@Param('id') id: string) {
    return this.kafka.overview(id);
  }

  @Get('brokers')
  brokers(@Param('id') id: string) {
    return this.kafka.listBrokers(id);
  }

  @Get('topics')
  topics(@Param('id') id: string, @Query('stats') stats?: string) {
    return this.kafka.listTopics(id, { stats: stats === '1' || stats === 'true' });
  }

  @Get('topics/:name')
  topic(@Param('id') id: string, @Param('name') name: string) {
    return this.kafka.topicDetail(id, name);
  }

  @Post('topics')
  async createTopic(@Param('id') id: string, @Body() body: CreateTopicDto) {
    await this.kafka.createTopic(id, body);
    await this.audit.record({
      action: 'topic.create',
      clusterId: id,
      target: body.name,
      ok: true,
    });
    return { ok: true };
  }

  @Delete('topics/:name')
  async deleteTopic(@Param('id') id: string, @Param('name') name: string) {
    await this.kafka.deleteTopic(id, name);
    await this.audit.record({
      action: 'topic.delete',
      clusterId: id,
      target: name,
      ok: true,
    });
    return { ok: true };
  }

  @Get('topics/:name/messages')
  browseMessages(
    @Param('id') id: string,
    @Param('name') name: string,
    @Query('partition') partition?: number,
    @Query('offset') offset?: string,
    @Query('limit') limit?: number,
    @Query('direction') direction?: 'latest' | 'earliest' | 'offset',
    @Query('q') q?: string,
    @Query('jsonPath') jsonPath?: string,
  ) {
    return this.kafka.browseMessages(id, {
      topic: name,
      partition,
      offset,
      limit,
      direction,
      q,
      jsonPath,
    });
  }

  @Post('messages')
  async produce(@Param('id') id: string, @Body() body: ProduceMessageDto) {
    await this.kafka.produce(id, body);
    await this.audit.record({
      action: 'message.produce',
      clusterId: id,
      target: body.topic,
      ok: true,
    });
    return { ok: true };
  }

  @Get('groups')
  groups(@Param('id') id: string) {
    return this.kafka.listGroups(id);
  }

  @Post('groups/reset')
  async reset(@Param('id') id: string, @Body() body: ResetOffsetsDto) {
    await this.kafka.resetOffsets(id, body);
    await this.audit.record({
      action: 'group.reset-offsets',
      clusterId: id,
      target: `${body.groupId} / ${body.topic}`,
      detail: body.strategy,
      ok: true,
    });
    return { ok: true };
  }

  @Delete('groups/:groupId')
  async deleteGroup(@Param('id') id: string, @Param('groupId') groupId: string) {
    await this.kafka.deleteGroup(id, groupId);
    await this.audit.record({
      action: 'group.delete',
      clusterId: id,
      target: groupId,
      ok: true,
    });
    return { ok: true };
  }

  @Get('schemas')
  schemas(@Param('id') id: string) {
    return this.kafka.listSchemas(id);
  }

  @Post('schemas')
  async createSchema(@Param('id') id: string, @Body() body: CreateSchemaDto) {
    await this.kafka.createSchema(id, body);
    await this.audit.record({
      action: 'schema.create',
      clusterId: id,
      target: body.subject,
      ok: true,
    });
    return { ok: true };
  }

  @Delete('schemas/:subject')
  async deleteSchema(@Param('id') id: string, @Param('subject') subject: string) {
    await this.kafka.deleteSchema(id, subject);
    await this.audit.record({
      action: 'schema.delete',
      clusterId: id,
      target: subject,
      ok: true,
    });
    return { ok: true };
  }

  @Get('searches')
  searches(@Param('id') id: string) {
    return this.clusters.savedSearches(id);
  }

  @Post('searches')
  saveSearch(@Param('id') id: string, @Body() body: SavedSearchDto) {
    return this.clusters.saveSearch(id, body);
  }

  @Delete('searches/:searchId')
  deleteSearch(@Param('id') id: string, @Param('searchId') searchId: string) {
    return this.clusters.deleteSearch(id, searchId);
  }

  @Get('audit')
  auditLog(@Param('id') id: string) {
    return this.audit.list(id);
  }
}

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list() {
    return this.audit.list();
  }
}
