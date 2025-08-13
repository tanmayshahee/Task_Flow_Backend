import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Task } from '../../modules/tasks/entities/task.entity';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';

// Optional: Prometheus metrics
import { Counter } from 'prom-client';

@Injectable()
export class OverdueTasksService {
  private readonly logger = new Logger(OverdueTasksService.name);
  private readonly overdueCounter: Counter<string>;

  constructor(
    @InjectQueue('task-processing') private readonly taskQueue: Queue,
    @InjectRepository(Task) private readonly tasksRepository: Repository<Task>,
    private readonly configService: ConfigService,
  ) {
    // Initialize Prometheus metric counter
    this.overdueCounter = new Counter({
      name: 'overdue_tasks_total',
      help: 'Total number of overdue tasks detected',
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async checkOverdueTasks() {
    this.logger.debug('Starting overdue tasks check...');

    const now = new Date();
    const overdueHours = this.configService.get<number>('OVERDUE_TASK_TTL_HOURS', 0);
    const dueBefore = new Date(now.getTime() - overdueHours * 60 * 60 * 1000);

    const batchSize = 500;
    let page = 0;
    let hasMore = true;
    let totalProcessed = 0;

    try {
      while (hasMore) {
        const overdueTasks = await this.tasksRepository.find({
          where: {
            dueDate: LessThan(dueBefore),
            status: TaskStatus.PENDING,
          },
          take: batchSize,
          skip: page * batchSize,
        });

        hasMore = overdueTasks.length === batchSize;
        page++;

        if (overdueTasks.length === 0 && page === 1) {
          this.logger.log('No overdue tasks found.');
          break;
        }

        this.logger.log(`Processing ${overdueTasks.length} overdue tasks in batch ${page}`);

        for (const task of overdueTasks) {
          await this.taskQueue.add(
            'process-overdue-task',
            { taskId: task.id },
            { jobId: `overdue-${task.id}` }, // Idempotency
          );
        }

        totalProcessed += overdueTasks.length;
        this.overdueCounter.inc(overdueTasks.length); // Observability metric
      }

      this.logger.log(`Overdue tasks check completed. Total queued: ${totalProcessed}`);
    } catch (error: any) {
      this.logger.error('Error checking overdue tasks', error.stack);
    }
  }
}
