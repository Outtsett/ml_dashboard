import { describe, it, expect } from 'vitest';
import { events } from '../../shared/src/schema';

describe('events table schema', () => {
  it('should have required columns', () => {
    const columns = Object.keys(events);
    expect(columns).toContain('id');
    expect(columns).toContain('streamId');
    expect(columns).toContain('streamPosition');
    expect(columns).toContain('type');
    expect(columns).toContain('version');
    expect(columns).toContain('data');
    expect(columns).toContain('metadata');
    expect(columns).toContain('createdAt');
  });
});
