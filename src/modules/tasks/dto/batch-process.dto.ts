// src/modules/tasks/dto/batch-process.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayMinSize, ArrayMaxSize, IsEnum, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

export enum BatchAction {
  COMPLETE = 'complete',
  DELETE = 'delete',
}

export class BatchProcessDto {
  @ApiProperty({ isArray: true, type: String })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  @Transform(({ value }) => Array.from(new Set(value))) // de-dupe
  tasks!: string[];

  @ApiProperty({ enum: BatchAction })
  @IsEnum(BatchAction)
  action!: BatchAction;
}

export type BatchItemResult =
  | { taskId: string; success: true; result: 'updated' | 'deleted' | 'noop' }
  | { taskId: string; success: false; error: string };

export interface BatchProcessResult {
  action: BatchAction;
  requested: number;
  affected: number;
  notFound: number;
  results: BatchItemResult[];
}
