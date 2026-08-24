/** Fixed-capacity circular buffer. O(1) push, O(n) snapshot. */
export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private count = 0;
  private cap: number;

  constructor(capacity: number) {
    if (capacity < 1) throw new RangeError('RingBuffer capacity must be >= 1');
    this.cap = capacity;
    this.buf = new Array(capacity);
  }

  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }

  get length(): number { return this.count; }

  toArray(): T[] {
    if (this.count === 0) return [];
    const result = new Array<T>(this.count);
    const start = (this.head - this.count + this.cap) % this.cap;
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buf[(start + i) % this.cap] as T;
    }
    return result;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.buf = new Array(this.cap);
  }
}
