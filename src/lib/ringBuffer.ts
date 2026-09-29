/** Fixed-capacity FIFO: pushing past capacity overwrites the oldest item. */
export class RingBuffer<T> {
  private items: (T | undefined)[];
  private start = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("RingBuffer capacity must be a positive integer");
    }
    this.items = Array.from<T | undefined>({ length: capacity });
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    const end = (this.start + this.count) % this.capacity;
    this.items[end] = item;
    if (this.count < this.capacity) this.count++;
    else this.start = (this.start + 1) % this.capacity;
  }

  /** i = 0 is the oldest item. */
  at(i: number): T | undefined {
    if (i < 0 || i >= this.count) return undefined;
    return this.items[(this.start + i) % this.capacity];
  }

  last(): T | undefined {
    return this.at(this.count - 1);
  }

  /** Oldest → newest; `n` limits to the newest n items. */
  toArray(n = this.count): T[] {
    const take = Math.min(Math.max(0, n), this.count);
    const out: T[] = [];
    for (let i = this.count - take; i < this.count; i++) out.push(this.at(i) as T);
    return out;
  }

  clear(): void {
    this.items = Array.from<T | undefined>({ length: this.capacity });
    this.start = 0;
    this.count = 0;
  }
}
