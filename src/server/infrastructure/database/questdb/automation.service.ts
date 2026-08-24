import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QuestDBService } from '../questdb.service';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const QUESTDB_PID_FILE = path.join(process.cwd(), '.questdb.pid');
const QUESTDB_ROOT = process.env.QUESTDB_ROOT || '';
const QUESTDB_JAVA = process.env.QUESTDB_JAVA || (QUESTDB_ROOT ? path.join(QUESTDB_ROOT, 'bin', 'java.exe') : '');

@Injectable()
export class QuestDBAutomationService implements OnModuleInit {
  private readonly logger = new Logger('QuestDBAutomation');

  constructor(private questdb: QuestDBService) {}

  async onModuleInit() {
    // Schedule periodic tasks
    setInterval(() => this.runDailyMaintenance(), 24 * 60 * 60 * 1000);
    this.logger.log('QuestDB automation service initialized');
  }

  /**
   * Restarts the QuestDB process safely.
   */
  async restartQuestDB(): Promise<{ success: boolean; message: string }> {
    this.logger.log('Restarting QuestDB...');
    
    // 1. Kill existing process
    if (fs.existsSync(QUESTDB_PID_FILE)) {
      try {
        const pid = parseInt(fs.readFileSync(QUESTDB_PID_FILE, 'utf-8').trim(), 10);
        if (!isNaN(pid)) {
          this.logger.log(`Killing QuestDB process ${pid}...`);
          process.kill(pid, 'SIGTERM');
          // Wait a bit for it to die
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (err) {
        this.logger.warn(`Could not kill existing process: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. Start new process
    try {
      this.logger.log('Spawning new QuestDB process...');
      const questdbProc = spawn(
        QUESTDB_JAVA,
        ['-m', 'io.questdb/io.questdb.ServerMain', '-d', QUESTDB_ROOT],
        { stdio: 'ignore', detached: true }
      );
      questdbProc.unref();
      
      if (questdbProc.pid) {
        fs.writeFileSync(QUESTDB_PID_FILE, String(questdbProc.pid), 'utf-8');
        this.logger.log(`QuestDB restarted with PID ${questdbProc.pid}`);
        
        // Wait for it to be ready
        let ready = false;
        for (let i = 0; i < 30; i++) {
          ready = await this.questdb.checkHealth();
          if (ready) break;
          await new Promise(r => setTimeout(r, 1000));
        }
        
        if (ready) {
          return { success: true, message: 'QuestDB restarted and verified' };
        } else {
          return { success: false, message: 'QuestDB process started but health check failed' };
        }
      }
    } catch (err) {
      return { success: false, message: `Failed to start QuestDB: ${err instanceof Error ? err.message : String(err)}` };
    }

    return { success: false, message: 'Unknown error during restart' };
  }

  /**
   * Runs daily maintenance tasks.
   * Previous no-ops (syncAllRollovers, refreshMaterializedViews) removed —
   * front-month detection is query-time, materialized views auto-refresh.
   */
  async runDailyMaintenance(): Promise<void> {
    this.logger.log('Daily maintenance ran — no pending tasks');
  }
}
