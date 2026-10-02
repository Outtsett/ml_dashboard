import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logError, logWarn, setErrorHandler } from '../../../apps/web/src/infrastructure/lib/error_logger';

describe('errorLogger', () => {
  beforeEach(() => { vi.restoreAllMocks(); setErrorHandler(undefined); });

  it('logs errors with component context', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('SSE', 'parse failed', { raw: 'x' });
    expect(spy).toHaveBeenCalledWith('[SSE] parse failed', { raw: 'x' });
  });

  it('logs warnings with component context', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logWarn('SSE', 'reconnecting', { attempt: 2 });
    expect(spy).toHaveBeenCalledWith('[SSE] reconnecting', { attempt: 2 });
  });

  it('calls custom error handler when set', () => {
    const handler = vi.fn();
    setErrorHandler(handler);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('test', 'boom', { x: 1 });
    expect(handler).toHaveBeenCalledWith('test', 'boom', { x: 1 });
  });
});
