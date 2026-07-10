// Global concurrency limiter — prevents overwhelming AI APIs
// With 1000 concurrent users, we need to queue requests

interface QueueEntry {
  resolve: () => void;
  priority: number; // lower = higher priority
}

class ConcurrencyLimiter {
  private running = 0;
  private queue: QueueEntry[] = [];
  private maxConcurrent: number;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  async acquire(priority = 0): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }

    // Wait in queue
    return new Promise<void>((resolve) => {
      this.queue.push({ resolve, priority });
      this.queue.sort((a, b) => a.priority - b.priority);
    });
  }

  release(): void {
    this.running--;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.running++;
      next.resolve();
    }
  }

  getStats() {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

// Limit concurrent AI calls (prevents overwhelming API providers)
// Each AI call = 1 slot. With multi-key rotation, each key can handle ~10-60 RPM.
// 20 concurrent = safe for most providers with 5+ keys
export const aiLimiter = new ConcurrencyLimiter(
  parseInt(process.env.MAX_CONCURRENT_AI || '20', 10)
);

// Limit concurrent MCP calls (prevents spawning too many Python processes)
export const mcpLimiter = new ConcurrencyLimiter(
  parseInt(process.env.MAX_CONCURRENT_MCP || '10', 10)
);
