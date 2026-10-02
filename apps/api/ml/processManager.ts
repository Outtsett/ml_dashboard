import { spawn, spawnSync, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { log } from "../infrastructure/lib/log";
import { getEventBus } from "../infrastructure/events/event-bus";
import { pgDb } from "../infrastructure/database/pg_db";
import { experimentsPg } from "@shared/pg_schema";

export interface JobConfig {
  jobId: string;
  model: string;
  dataset: string;
  // Carried verbatim from the launch request to the job's config file. Nothing
  // on the Node side reads inside them, so they are not given a shape here —
  // the training script owns their schema.
  features: unknown;
  hyperparameters: unknown;
  validation: unknown;
  isSweep: boolean;
  instrument: string;
  timeframe: string;
  dataSize: number;
}

export class ProcessManager extends EventEmitter {
  private activeJobs = new Map<string, ChildProcess>();
  private jobMetrics = new Map<string, { reward: number; valScore: number }>();
  
  public async launchJob(config: JobConfig): Promise<void> {
    log(`[JobController] Launching ${config.isSweep ? 'sweep' : 'train'} job: ${config.jobId}`, "mlops");
    this.jobMetrics.set(config.jobId, { reward: 0, valScore: 0 });
    
    // In a real environment, we would dump the config to a temporary YAML file here, 
    // and pass the file path to python script.
    const baseScript = config.model === 'DQNAgent' ? 'train_dqn.py' : 'train_ppo.py';
    const sweepScript = config.model === 'DQNAgent' ? 'sweep_dqn.py' : 'sweep_ppo.py';
    const configFile = config.model === 'DQNAgent' ? 'configs/rl_dqn_default.yaml' : 'configs/rl_ppo_default.yaml';
    const pythonScript = config.isSweep ? sweepScript : baseScript;
    const workspaceRoot = 'E:\\source\\repos\\ml_dashboard\\trading_models';
    const pythonExe = 'C:\\Users\\tyler\\anaconda3\\python.exe';
    const prepareArgs = [
      'scripts/prepare_dataset.py',
      '--instrument', config.instrument,
      '--timeframe', config.timeframe,
      '--data-size', config.dataSize.toString(),
      '--job-id', config.jobId
    ];

    const env = { ...process.env, PYTHONUNBUFFERED: "1" } as NodeJS.ProcessEnv;
    const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
    env[pathKey] = `C:\\Users\\tyler\\Anaconda3\\Library\\bin;C:\\Users\\tyler\\Anaconda3\\Lib\\site-packages\\torch\\lib;${env[pathKey] || ''}`;

    log(`[JobController] Preparing dataset for ${config.jobId}...`, "mlops");
    
    // Run dataset preparation synchronously or await a promise
    await new Promise<void>((resolve, reject) => {
      const prepChild = spawn(pythonExe, prepareArgs, { cwd: process.cwd(), env });
      prepChild.stdout.on('data', data => log(`[Prep STDOUT] ${data.toString().trim()}`, "mlops"));
      prepChild.stderr.on('data', data => log(`[Prep STDERR] ${data.toString().trim()}`, "mlops"));
      prepChild.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`prepare_dataset.py exited with code ${code}`));
      });
    });

    const pythonArgs = [
      pythonScript,
      '--config', configFile,
      '--instrument', config.instrument,
      '--timeframe', config.timeframe,
        '--train-data', `${process.env.LAKE_ROOT ?? 'E:/lake'}/derived/runs/${config.jobId}/train.parquet`,
      '--test-data', `D:/ml_data/runs/${config.jobId}/test.parquet`
    ];
    
    log(`[JobController] Starting training for ${config.jobId}...`, "mlops");
    const child = spawn(pythonExe, pythonArgs, {
      cwd: workspaceRoot,
      env
    });

    this.activeJobs.set(config.jobId, child);

    child.stdout.on("data", (data) => {
      const msgs = data.toString().trim().split('\n');
      for (const msg of msgs) {
        if (!msg) continue;
        log(`[${config.jobId} STDOUT] ${msg}`, "mlops");
        this.emit("metrics", { jobId: config.jobId, data: msg });
        
        try {
          const parsed = JSON.parse(msg);
          if (parsed.loss !== undefined || parsed.reward !== undefined) {
            
            // Track metrics for leaderboard insertion
            const currentMetrics = this.jobMetrics.get(config.jobId);
            if (currentMetrics) {
              if (parsed.reward !== undefined) currentMetrics.reward = parsed.reward;
              if (parsed.equity !== undefined) currentMetrics.valScore = parsed.equity;
            }

            getEventBus().emit({
              // @ts-expect-error - metric is not a member of the DomainEvent union (ad-hoc RL telemetry channel)
              type: 'metric',
              timestamp: new Date().toISOString(),
              data: {
                metrics: parsed
              }
            });
          }
        } catch {
          getEventBus().emit({
            // @ts-expect-error - log is not a member of the DomainEvent union (ad-hoc RL telemetry channel)
            type: 'log',
            timestamp: new Date().toISOString(),
            data: { message: msg, level: 'info' }
          });
        }
      }
    });

    child.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) {
        log(`[${config.jobId} STDERR] ${msg}`, "mlops");
        getEventBus().emit({
          // @ts-expect-error - log is not a member of the DomainEvent union (ad-hoc RL telemetry channel)
          type: 'log',
          timestamp: new Date().toISOString(),
          data: { message: msg, level: 'warn' }
        });
      }
    });

    child.on("close", async (code) => {
      log(`[JobController] Job ${config.jobId} exited with code ${code}`, "mlops");
      this.activeJobs.delete(config.jobId);
      
      const metrics = this.jobMetrics.get(config.jobId) || { reward: 0, valScore: 0 };
      this.jobMetrics.delete(config.jobId);

      // Write to Leaderboard Database
      try {
        await pgDb.insert(experimentsPg).values({
          experimentId: config.jobId,
          model: `PPO ${config.instrument.toUpperCase()} ${config.timeframe}`,
          reward: metrics.reward,
          valScore: metrics.valScore,
          status: code === 0 ? "completed" : "failed",
          description: `RL Training on ${config.instrument} ${config.timeframe} (Data Size: ${config.dataSize})`
        });
        log(`[JobController] Wrote experiment ${config.jobId} to leaderboard.`, "mlops");
        
        // Broadcast the MLStudio refresh event
        getEventBus().emit({
           // @ts-expect-error - log is not a member of the DomainEvent union (ad-hoc RL telemetry channel)
           type: 'log',
           timestamp: new Date().toISOString(),
           data: { message: `Experiment ${config.jobId} completed and saved to leaderboard.`, level: 'info' }
        });
      } catch (dbErr) {
        log(`[JobController] Failed to write leaderboard data: ${dbErr}`, "error");
      }

      this.emit("job_completed", { jobId: config.jobId, code });
    });
  } // End of launchJob

  public abortAll(): void {
    for (const [jobId, child] of this.activeJobs.entries()) {
      log(`[JobController] Aborting job ${jobId}`, "mlops");
      if (process.platform === 'win32' && child.pid) {
        spawnSync("taskkill", ["/pid", child.pid.toString(), "/f", "/t"]);
      } else {
        child.kill("SIGKILL");
      }
      // Don't delete from activeJobs here, let the 'close' event handler do it so DB logic still runs
    }
    getEventBus().emit({
      // @ts-expect-error - log is not a member of the DomainEvent union (ad-hoc RL telemetry channel)
      type: 'log',
      timestamp: new Date().toISOString(),
      data: { message: `Abort signal sent to all active jobs.`, level: 'warn' }
    });
  }
}

export const processManager = new ProcessManager();
