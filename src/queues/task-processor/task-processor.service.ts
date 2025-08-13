import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TasksService } from '../../modules/tasks/tasks.service';
import * as client from 'prom-client';

// Define job payload types
interface StatusUpdateJob {
  taskId: string;
  status: string;
}

interface OverdueTasksJob {
  notifyUsers?: boolean;
}

@Injectable()
@Processor('task-processing', { concurrency: 5 }) // process up to 5 jobs in parallel
export class TaskProcessorService extends WorkerHost {
  private readonly logger = new Logger(TaskProcessorService.name);

  // Prometheus metrics
  private static jobsProcessedCounter = new client.Counter({
    name: 'jobs_processed_total',
    help: 'Total number of processed jobs',
    labelNames: ['jobType', 'status'],
  });

  constructor(private readonly tasksService: TasksService) {
    super();
  }

  async process(job: Job): Promise<any> {
    try {
      this.logger.debug(
        `Processing job ${job.id} [type=${job.name}] attempt=${job.attemptsMade + 1}`,
      );

      switch (job.name) {
        case 'task-status-update':
          return await this.handleStatusUpdate(job.data as StatusUpdateJob);

        case 'overdue-tasks-notification':
          return await this.handleOverdueTasks(job.data as OverdueTasksJob);

        default:
          throw new Error(`Unknown job type: ${job.name}`);
      }
    } catch (error) {
      this.logger.error(
        `Job ${job.id} [type=${job.name}] failed on attempt ${
          job.attemptsMade + 1
        }: ${error instanceof Error ? error.message : error}`,
      );

      TaskProcessorService.jobsProcessedCounter.inc({
        jobType: job.name,
        status: 'error',
      });

      // BullMQ will retry if attempts > 1
      throw error;
    }
  }

  private async handleStatusUpdate(data: StatusUpdateJob) {
    const { taskId, status } = data;

    if (!taskId || !status) {
      this.logger.warn('Missing required taskId or status in job data');
      return { success: false, error: 'Missing required data' };
    }

    // TODO: Add enum validation for status before updating
    const task = await this.tasksService.updateStatus(taskId, status);

    TaskProcessorService.jobsProcessedCounter.inc({
      jobType: 'task-status-update',
      status: 'success',
    });

    return {
      success: true,
      taskId: task.id,
      newStatus: task.status,
    };
  }

  private async handleOverdueTasks(data: OverdueTasksJob) {
    const batchSize = 100;
    let offset = 0;
    let totalProcessed = 0;

    while (true) {
      const overdueTasks = await this.tasksService.findOverdueTasks(batchSize, offset);
      if (overdueTasks.length === 0) break;

      for (const task of overdueTasks) {
        if (data.notifyUsers) {
          await this.tasksService.notifyUser(task.userId, task.id);
        }
      }

      totalProcessed += overdueTasks.length;
      offset += batchSize;
    }

    TaskProcessorService.jobsProcessedCounter.inc({
      jobType: 'overdue-tasks-notification',
      status: 'success',
    });

    this.logger.log(`Processed ${totalProcessed} overdue tasks`);
    return { success: true, count: totalProcessed };
  }
}
