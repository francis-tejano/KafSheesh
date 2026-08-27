import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class JumpHopDto {
  @IsString()
  host!: string;

  @IsInt()
  @Min(1)
  port!: number;

  @IsString()
  username!: string;

  @IsIn(['password', 'privateKey'])
  authType!: 'password' | 'privateKey';

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  privateKey?: string;

  @IsOptional()
  @IsString()
  privateKeyFileName?: string;

  @IsOptional()
  @IsString()
  passphrase?: string;

  @IsOptional()
  @IsString()
  connectHost?: string;
}

class TunnelDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  host!: string;

  @IsInt()
  @Min(1)
  port!: number;

  @IsString()
  username!: string;

  @IsIn(['password', 'privateKey'])
  authType!: 'password' | 'privateKey';

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  privateKey?: string;

  @IsOptional()
  @IsString()
  privateKeyFileName?: string;

  @IsOptional()
  @IsString()
  passphrase?: string;

  @IsOptional()
  @IsString()
  connectHost?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => JumpHopDto)
  hops?: JumpHopDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  remoteBrokers?: string[];

  @IsOptional()
  @IsInt()
  keepAliveIntervalMs?: number;
}

class SaslDto {
  @IsIn(['plain', 'scram-sha-256', 'scram-sha-512'])
  mechanism!: 'plain' | 'scram-sha-256' | 'scram-sha-512';

  @IsString()
  username!: string;

  @IsString()
  password!: string;
}

class SchemaRegistryDto {
  @IsString()
  url!: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;
}

export class CreateClusterDto {
  @IsString()
  name!: string;

  @IsArray()
  @IsString({ each: true })
  brokers!: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TunnelDto)
  tunnel?: TunnelDto;

  @IsOptional()
  @IsBoolean()
  ssl?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => SaslDto)
  sasl?: SaslDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SchemaRegistryDto)
  schemaRegistry?: SchemaRegistryDto;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateClusterDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  brokers?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TunnelDto)
  tunnel?: TunnelDto;

  @IsOptional()
  @IsBoolean()
  ssl?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => SaslDto)
  sasl?: SaslDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SchemaRegistryDto)
  schemaRegistry?: SchemaRegistryDto;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateTopicDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  partitions!: number;

  @IsInt()
  @Min(1)
  replicationFactor!: number;
}

export class ProduceMessageDto {
  @IsString()
  topic!: string;

  @IsOptional()
  @IsString()
  key?: string;

  @IsString()
  value!: string;

  @IsOptional()
  @IsInt()
  partition?: number;
}

export class ResetOffsetsDto {
  @IsString()
  groupId!: string;

  @IsString()
  topic!: string;

  @IsIn(['earliest', 'latest', 'timestamp', 'offset'])
  strategy!: 'earliest' | 'latest' | 'timestamp' | 'offset';

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  partitions?: number[];

  @IsOptional()
  @IsString()
  timestamp?: string;

  @IsOptional()
  @IsString()
  offset?: string;
}

export class CreateSchemaDto {
  @IsString()
  subject!: string;

  @IsString()
  schema!: string;

  @IsOptional()
  @IsString()
  schemaType?: string;
}

export class SavedSearchDto {
  @IsString()
  name!: string;

  @IsString()
  topic!: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  jsonPath?: string;
}
