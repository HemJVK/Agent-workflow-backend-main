import { IsArray, IsOptional, ValidateNested, IsString, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

export class WorkflowNodeDto {
  @IsString()
  id: string;

  @IsString()
  type: string;

  @IsObject()
  @IsOptional()
  position?: Record<string, any>;

  @IsObject()
  @IsOptional()
  data?: Record<string, any>;
}

export class WorkflowEdgeDto {
  @IsString()
  id: string;

  @IsString()
  source: string;

  @IsString()
  target: string;

  @IsString()
  @IsOptional()
  sourceHandle?: string;

  @IsString()
  @IsOptional()
  targetHandle?: string;

  @IsObject()
  @IsOptional()
  data?: Record<string, any>;
}

export class UpdateDraftDto {
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => WorkflowNodeDto)
  nodes?: WorkflowNodeDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => WorkflowEdgeDto)
  edges?: WorkflowEdgeDto[];
}
