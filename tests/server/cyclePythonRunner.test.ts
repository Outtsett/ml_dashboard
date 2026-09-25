/**
 * `pythonRunner.ts`'s Model Cycle plumbing: stdout line-buffering across
 * chunks, the stdout retention cap, and `sendControl`/`stop` (mocked child
 * process — these tests never spawn a real Python process).
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  splitBufferedLines,
  appendCapped,
  STDOUT_RETENTION_BYTES,
  PythonRunner,
} from '../../src/server/training/runners/pythonRunner';
import type { CycleControl } from '../../src/shared/cycle/schema';

describe('splitBufferedLines — stdout chunk buffering', () => {
  it('parses a single line delivered in one chunk', () => {
    const { lines, carry } = splitBufferedLines('', '{"type":"log","message":"hi"}\n');
    expect(lines).toEqual(['{"type":"log","message":"hi"}']);
    expect(carry).toBe('');
  });

  it('a long JSON line split across three chunks parses once, correctly', () => {
    // Simulates a ~200 KB cycle_bars line arriving in three stdout 'data' events.
    const bigArray = Array.from({ length: 5000 }, (_, i) => i);
    const fullLine = JSON.stringify({ type: 'cycle_bars', seq: 7, timestamps: bigArray });
    const third = Math.floor(fullLine.length / 3);
    const chunk1 = fullLine.slice(0, third);
    const chunk2 = fullLine.slice(third, third * 2);
    const chunk3 = fullLine.slice(third * 2) + '\n';

    let carry = '';
    let allLines: string[] = [];

    ({ lines: allLines, carry } = splitBufferedLines(carry, chunk1));
    expect(allLines).toEqual([]); // no newline yet — nothing to parse
    expect(carry).toBe(chunk1);

    ({ lines: allLines, carry } = splitBufferedLines(carry, chunk2));
    expect(allLines).toEqual([]);
    expect(carry).toBe(chunk1 + chunk2);

    ({ lines: allLines, carry } = splitBufferedLines(carry, chunk3));
    expect(allLines.length).toBe(1); // exactly one line — never split into garbage fragments
    expect(carry).toBe('');
    expect(() => JSON.parse(allLines[0]!)).not.toThrow();
    expect(JSON.parse(allLines[0]!)).toEqual(JSON.parse(fullLine));
  });

  it('two complete lines in one chunk both parse, in order', () => {
    const { lines, carry } = splitBufferedLines('', '{"a":1}\n{"a":2}\n');
    expect(lines).toEqual(['{"a":1}', '{"a":2}']);
    expect(carry).toBe('');
  });

  it('a chunk ending mid-line carries the partial line to the next call', () => {
    const first = splitBufferedLines('', '{"a":1}\n{"a":2');
    expect(first.lines).toEqual(['{"a":1}']);
    expect(first.carry).toBe('{"a":2');

    const second = splitBufferedLines(first.carry, '}\n');
    expect(second.lines).toEqual(['{"a":2}']);
    expect(second.carry).toBe('');
  });

  it('blank lines are dropped, not emitted as empty strings', () => {
    const { lines } = splitBufferedLines('', '{"a":1}\n\n\n{"a":2}\n');
    expect(lines).toEqual(['{"a":1}', '{"a":2}']);
  });
});

describe('appendCapped — bounded stdout retention', () => {
  it('keeps the full buffer under the cap', () => {
    const result = appendCapped('abc', 'def');
    expect(result).toBe('abcdef');
  });

  it('trims to the retained tail once the cap is exceeded', () => {
    const big = 'x'.repeat(STDOUT_RETENTION_BYTES);
    const result = appendCapped(big, 'TAIL_MARKER');
    expect(result.length).toBe(STDOUT_RETENTION_BYTES);
    expect(result.endsWith('TAIL_MARKER')).toBe(true);
    // The __JSON_OUTPUT__ marker lookup (pythonRunner's close handler) is a
    // plain substring search over the retained tail — it must still find a
    // marker written near the end of a long run.
    expect(result.indexOf('TAIL_MARKER')).toBeGreaterThanOrEqual(0);
  });
});

// ─── sendControl / stop — mocked child, no real process spawn ─────────────

interface FakeStdin extends EventEmitter {
  writable: boolean;
  destroyed: boolean;
  write: (chunk: string) => boolean;
}

function fakeChild(overrides: Partial<FakeStdin> = {}) {
  const stdin = Object.assign(new EventEmitter(), {
    writable: true,
    destroyed: false,
    write: vi.fn(() => true),
    ...overrides,
  }) as FakeStdin;
  return { pid: 4242, stdin, kill: vi.fn() };
}

function injectSession(runner: PythonRunner, sessionId: string, child: ReturnType<typeof fakeChild>) {
  // `sessions` is private — tests reach it the same way the class itself
  // does internally, via a cast, rather than spawning a real process.
  (runner as unknown as { sessions: Map<string, unknown> }).sessions.set(sessionId, {
    sessionId,
    finished: false,
    child,
    stdout: '',
    stderr: '',
    stdoutCarry: '',
  });
}

describe('PythonRunner.sendControl', () => {
  it('writes one JSON line per control command to stdin', () => {
    const runner = new PythonRunner();
    const child = fakeChild();
    injectSession(runner, 'sess-1', child);

    const command: CycleControl = { command: 'pause' };
    const delivered = runner.sendControl('sess-1', command);

    expect(delivered).toBe(true);
    expect(child.stdin.write).toHaveBeenCalledTimes(1);
    expect(child.stdin.write).toHaveBeenCalledWith('{"command":"pause"}\n');
  });

  it('returns false for a command targeting no live session', () => {
    const runner = new PythonRunner();
    expect(runner.sendControl('does-not-exist', { command: 'resume' })).toBe(false);
  });

  it('returns false when stdin is not writable, without throwing', () => {
    const runner = new PythonRunner();
    const child = fakeChild({ writable: false });
    injectSession(runner, 'sess-2', child);
    expect(() => runner.sendControl('sess-2', { command: 'stop' })).not.toThrow();
    expect(runner.sendControl('sess-2', { command: 'stop' })).toBe(false);
    expect(child.stdin.write).not.toHaveBeenCalled();
  });

  it('swallows a write that throws (e.g. EPIPE) and returns false', () => {
    const runner = new PythonRunner();
    const child = fakeChild({
      write: vi.fn(() => {
        throw new Error('EPIPE');
      }),
    });
    injectSession(runner, 'sess-3', child);
    expect(() => runner.sendControl('sess-3', { command: 'pace', barsPerSecond: 100 })).not.toThrow();
    expect(runner.sendControl('sess-3', { command: 'pace', barsPerSecond: 100 })).toBe(false);
  });
});
