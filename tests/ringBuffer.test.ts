import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../src/client/src/infrastructure/storage/ring_buffer';

describe('RingBuffer', () => {
  it('pushes and retrieves items in order', () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1); buf.push(2); buf.push(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
    expect(buf.length).toBe(3);
  });

  it('overwrites oldest when full', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1); buf.push(2); buf.push(3); buf.push(4);
    expect(buf.toArray()).toEqual([2, 3, 4]);
  });

  it('clears all items and resets', () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1); buf.push(2); buf.clear();
    expect(buf.toArray()).toEqual([]);
    expect(buf.length).toBe(0);
    buf.push(10);
    expect(buf.toArray()).toEqual([10]);
  });

  it('handles many wraps correctly', () => {
    const buf = new RingBuffer<number>(3);
    for (let i = 0; i < 100; i++) buf.push(i);
    expect(buf.toArray()).toEqual([97, 98, 99]);
  });

  it('returns independent snapshots', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1); buf.push(2);
    const snap1 = buf.toArray();
    buf.push(3);
    expect(snap1).toEqual([1, 2]);
    expect(buf.toArray()).toEqual([1, 2, 3]);
  });

  it('rejects zero capacity', () => {
    expect(() => new RingBuffer(0)).toThrow();
  });
});
