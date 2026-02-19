#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';

const QUESTDB_VERSION = '8.2.1';
const QUESTDB_DIR = '/tmp/questdb';
const QUESTDB_DATA = '/tmp/questdb-data';
const QUESTDB_JAR = path.join(QUESTDB_DIR, 'questdb.jar');
const QUESTDB_URL = `https://github.com/questdb/questdb/releases/download/${QUESTDB_VERSION}/questdb-${QUESTDB_VERSION}-no-jre-bin.tar.gz`;

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        https.get(response.headers.location, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => file.close(resolve));
        }).on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => file.close(resolve));
      }
    }).on('error', reject);
  });
}

async function ensureQuestDB() {
  if (fs.existsSync(QUESTDB_JAR)) {
    console.log('[QuestDB] Already downloaded');
    return;
  }

  console.log('[QuestDB] Downloading...');
  fs.mkdirSync(QUESTDB_DIR, { recursive: true });
  
  const tarPath = path.join(QUESTDB_DIR, 'questdb.tar.gz');
  await downloadFile(QUESTDB_URL, tarPath);
  
  execSync(`tar -xzf ${tarPath} -C ${QUESTDB_DIR} --strip-components=1`, { stdio: 'inherit' });
  fs.unlinkSync(tarPath);
  console.log('[QuestDB] Downloaded successfully');
}

function cleanupLocks() {
  const lockPatterns = ['db.lock', '_wal_lock', '.lock'];
  
  function cleanDir(dir) {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          cleanDir(fullPath);
        } else if (lockPatterns.some(p => entry.name.includes(p))) {
          try {
            fs.unlinkSync(fullPath);
            console.log(`[QuestDB] Removed stale lock: ${fullPath}`);
          } catch (e) {}
        }
      }
    } catch (e) {}
  }
  
  cleanDir(QUESTDB_DATA);
}

async function startQuestDB() {
  await ensureQuestDB();
  
  fs.mkdirSync(QUESTDB_DATA, { recursive: true });
  fs.mkdirSync(path.join(QUESTDB_DATA, 'conf'), { recursive: true });
  
  cleanupLocks();
  
  const javaTemp = path.join(QUESTDB_DATA, 'java_temp');
  fs.mkdirSync(javaTemp, { recursive: true });
  
  console.log('[QuestDB] Starting...');
  
  const proc = spawn('java', [
    `-Djava.io.tmpdir=${javaTemp}`,
    '-jar', QUESTDB_JAR,
    '-d', QUESTDB_DATA
  ], {
    stdio: ['ignore', 'inherit', 'inherit']
  });

  proc.on('error', (err) => {
    console.error('[QuestDB] Failed to start:', err);
    process.exit(1);
  });

  proc.on('exit', (code, signal) => {
    console.log(`[QuestDB] Exited with code ${code}, signal ${signal}`);
    process.exit(code || 1);
  });

  process.on('SIGINT', () => {
    console.log('[QuestDB] Shutting down...');
    proc.kill('SIGTERM');
  });

  process.on('SIGTERM', () => {
    console.log('[QuestDB] Shutting down...');
    proc.kill('SIGTERM');
  });
}

startQuestDB().catch(err => {
  console.error('[QuestDB] Startup error:', err);
  process.exit(1);
});
