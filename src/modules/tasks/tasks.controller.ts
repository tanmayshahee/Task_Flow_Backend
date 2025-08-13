import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiBody,
} from '@nestjs/swagger';

import { Task } from './entities/task.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetTasksQueryDto } from './dto/get-tasks-query.dto';
import { TaskStatsDto } from './dto/task-stats.dto';
import { ParseUUIDPipe } from '@nestjs/common';
import { BatchProcessDto, BatchProcessResult } from './dto/batch-process.dto';
import { ThrottlerGuard, Throttle, seconds } from '@nestjs/throttler';

@ApiTags('tasks')
@Controller('tasks')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: seconds(60) } })
@ApiBearerAuth()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new task' })
  async create(@Body() createTaskDto: CreateTaskDto) {
    const task = await this.tasksService.create(createTaskDto);
    return task;
  }

  @Get()
  @ApiOperation({ summary: 'Find all tasks with optional filtering' })
  async findAll(@Query() query: GetTasksQueryDto) {
    return this.tasksService.findAll(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get task statistics' })
  async getStats(): Promise<TaskStatsDto> {
    return this.tasksService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Find a task by ID' })
  async findOne(@Param('id') id: string) {
    return this.tasksService.findOneOrFail(id);
  }
  @Patch(':id')
  @ApiOperation({ summary: 'Update a task' })
  @ApiOkResponse({ type: Task })
  @ApiNotFoundResponse({ description: 'Task not found' })
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() updateTaskDto: UpdateTaskDto,
  ): Promise<Task> {
    return this.tasksService.update(id, updateTaskDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a task' })
  @ApiNotFoundResponse({ description: 'Task not found' })
  remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<void> {
    return this.tasksService.remove(id);
  }

  @Post('batch')
  @ApiOperation({ summary: 'Batch process multiple tasks' })
  @ApiBody({ type: BatchProcessDto })
  @ApiOkResponse({ description: 'Batch result', type: Object })
  async batchProcess(@Body() dto: BatchProcessDto): Promise<BatchProcessResult> {
    return this.tasksService.batchProcess(dto);
  }
}
