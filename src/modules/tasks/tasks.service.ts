import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, DataSource, DeleteResult, In, LessThan } from 'typeorm';
import { Task } from './entities/task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TaskStatus } from './enums/task-status.enum';
import { GetTasksQueryDto } from './dto/get-tasks-query.dto';
import { TaskStatsDto } from './dto/task-stats.dto';
import { TaskPriority } from './enums/task-priority.enum';
import {
  BatchAction,
  BatchProcessDto,
  BatchProcessResult,
  BatchItemResult,
} from './dto/batch-process.dto';

export interface PaginatedTasks {
  data: Task[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pageCount: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pageCount: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
    private readonly dataSource: DataSource,
    @InjectQueue('task-processing')
    private taskQueue: Queue,
  ) {}

  async create(dto: CreateTaskDto): Promise<Task> {
    return this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(Task);

      const task = repo.create({
        ...dto,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      });
      const saved = await repo.save(task);

      try {
        await this.taskQueue.add(
          'task-status-update',
          { taskId: saved.id, status: saved.status },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
            removeOnFail: 50,
            jobId: `task-status-update:${saved.id}:${saved.status}`, // dedupe
          },
        );
      } catch (e) {
        this.logger.warn(`Queue unavailable; will retry later for task ${saved.id}`);
      }

      return saved;
    });
  }

  async findAll(query: GetTasksQueryDto): Promise<PaginatedTasks> {
    const { status, priority, page = 1, limit = 10 } = query;

    const where: FindOptionsWhere<Task> = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;

    const [items, total] = await this.tasksRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const pageCount = Math.ceil(total / limit);

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        pageCount,
        hasNextPage: page < pageCount,
        hasPrevPage: page > 1,
      },
    };
  }

  async findOneOrFail(id: string): Promise<Task> {
    const task = await this.tasksRepository.findOne({ where: { id } });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }

  async update(id: string, dto: UpdateTaskDto): Promise<Task> {
    const { updated, statusChanged } = await this.dataSource.transaction(async manager => {
      // Read only what we need to detect a status change
      const before = await manager.getRepository(Task).findOne({
        where: { id },
        select: ['id', 'status'],
      });
      if (!before) throw new NotFoundException('Task not found');

      // Single UPDATE with RETURNING * (Postgres)
      const qb = manager
        .getRepository(Task)
        .createQueryBuilder()
        .update(Task)
        .set({ ...dto, updatedAt: () => 'NOW()' }) // keep audit fields current
        .where('id = :id', { id })
        .returning('*');

      const result = await qb.execute();
      const updated = result.raw[0] as Task;

      const statusChanged = dto.status !== undefined && dto.status !== before.status;
      return { updated, statusChanged };
    });

    // Fire-and-forget queue enqueue (don’t fail the request if Redis is down)
    if (statusChanged) {
      try {
        await this.taskQueue.add('task-status-update', {
          taskId: updated.id,
          status: updated.status,
        });
      } catch (e) {
        // Optionally log, but don’t throw
        this.logger.warn(`Failed to enqueue status update for task ${updated.id}`, e);
      }
    }

    return updated;
  }

  async remove(id: string): Promise<void> {
    const result: DeleteResult = await this.tasksRepository.delete({ id }); // single SQL round-trip
    if (!result.affected) {
      throw new NotFoundException('Task not found');
    }
  }

  async findByStatus(status: TaskStatus, page = 1, limit = 20): Promise<PaginatedResponse<Task>> {
    const [data, total] = await this.tasksRepository.findAndCount({
      where: { status },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const pageCount = Math.ceil(total / limit);
    return {
      data,
      meta: {
        total,
        page,
        limit,
        pageCount,
        hasNextPage: page < pageCount,
        hasPrevPage: page > 1,
      },
    };
  }

  async findOverdueTasks(limit: number, offset: number): Promise<Task[]> {
    const now = new Date();

    return this.tasksRepository.find({
      where: {
        dueDate: LessThan(now),
        status: TaskStatus.PENDING,
      },
      take: limit,
      skip: offset,
    });
  }

  async notifyUser(userId: string, taskId: string): Promise<void> {
    // Example: Fetch user email from User entity (if needed)
    // const user = await this.userRepository.findOne({ where: { id: userId } });

    // TODO: Replace this with actual notification logic (email, push, etc.)
    this.logger.log(`Notifying user ${userId} about overdue task ${taskId}`);

    // Example: Email service integration
    // await this.emailService.send({
    //   to: user.email,
    //   subject: 'Overdue Task Reminder',
    //   body: `Your task with ID ${taskId} is overdue. Please take action.`,
    // });
  }

  async updateStatus(id: string, status: string): Promise<Task> {
    // This method will be called by the task processor
    const task = await this.findOneOrFail(id);
    task.status = status as any;
    return this.tasksRepository.save(task);
  }

  async getStats(): Promise<TaskStatsDto> {
    const raw = await this.tasksRepository
      .createQueryBuilder('t')
      .select('COUNT(*)', 'total')
      .addSelect(`SUM(CASE WHEN t.status = :completed THEN 1 ELSE 0 END)`, 'completed')
      .addSelect(`SUM(CASE WHEN t.status = :inProgress THEN 1 ELSE 0 END)`, 'inProgress')
      .addSelect(`SUM(CASE WHEN t.status = :pending THEN 1 ELSE 0 END)`, 'pending')
      .addSelect(`SUM(CASE WHEN t.priority = :high THEN 1 ELSE 0 END)`, 'highPriority')
      .setParameters({
        completed: TaskStatus.COMPLETED,
        inProgress: TaskStatus.IN_PROGRESS,
        pending: TaskStatus.PENDING,
        high: TaskPriority.HIGH,
      })
      .getRawOne<{
        total: string;
        completed: string;
        inProgress: string;
        pending: string;
        highPriority: string;
      }>();

    return {
      total: Number(raw?.total),
      completed: Number(raw?.completed),
      inProgress: Number(raw?.inProgress),
      pending: Number(raw?.pending),
      highPriority: Number(raw?.highPriority),
    };
  }

  async batchProcess(dto: BatchProcessDto): Promise<BatchProcessResult> {
    const { tasks: ids, action } = dto;

    if (ids.length === 0) {
      throw new BadRequestException('No task IDs provided');
    }

    return this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(Task);

      // 1) Fetch existing ids once (to avoid N+1 and to report not-found cleanly)
      const existing = await repo.find({
        where: { id: In(ids) },
        select: ['id', 'status'],
      });
      const existingIds = new Set(existing.map(t => t.id));
      const notFoundIds = ids.filter(id => !existingIds.has(id));

      let affected = 0;
      const perItem: BatchItemResult[] = [];

      if (action === BatchAction.COMPLETE) {
        // Update in one statement; only rows not already completed
        const res = await repo
          .createQueryBuilder()
          .update(Task)
          .set({ status: TaskStatus.COMPLETED, updatedAt: () => 'NOW()' })
          .where('id IN (:...ids)', { ids: Array.from(existingIds) })
          .andWhere('status <> :completed', { completed: TaskStatus.COMPLETED })
          .returning(['id', 'status'])
          .execute();

        affected = res.affected ?? 0;
        const updatedIds = res.raw.map((r: any) => r.id as string);

        // Build item results
        const updatedSet = new Set(updatedIds);
        for (const id of ids) {
          if (!existingIds.has(id))
            perItem.push({ taskId: id, success: false, error: 'not_found' });
          else if (updatedSet.has(id))
            perItem.push({ taskId: id, success: true, result: 'updated' });
          else perItem.push({ taskId: id, success: true, result: 'noop' }); // already completed
        }

        // Enqueue in bulk (non-blocking)
        if (updatedIds.length) {
          try {
            await this.taskQueue.addBulk(
              updatedIds.map((id: any) => ({
                name: 'task-status-update',
                data: { taskId: id, status: TaskStatus.COMPLETED },
              })),
            );
          } catch {
            // swallow queue errors; API success shouldn't depend on Redis
          }
        }
      } else if (action === BatchAction.DELETE) {
        const res = await repo
          .createQueryBuilder()
          .delete()
          .from(Task)
          .where('id IN (:...ids)', { ids: Array.from(existingIds) })
          .execute();

        affected = res.affected ?? 0;

        const deletedSet = new Set(existing.map(t => t.id));
        for (const id of ids) {
          if (!existingIds.has(id))
            perItem.push({ taskId: id, success: false, error: 'not_found' });
          else perItem.push({ taskId: id, success: true, result: 'deleted' });
        }
      } else {
        throw new BadRequestException(`Unknown action: ${action}`);
      }

      return {
        action,
        requested: ids.length,
        affected,
        notFound: notFoundIds.length,
        results: perItem,
      };
    });
  }
}
