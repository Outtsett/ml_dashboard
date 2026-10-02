import { EventEmitter } from 'events';
import { logInfo } from "./log";

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  resetTimeout: number;
  name: string;
}

export interface CircuitBreakerStats {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  totalRequests: number;
  totalFailures: number;
}

export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailure: Date | null = null;
  private lastSuccess: Date | null = null;
  private nextAttempt: number = 0;
  private totalRequests: number = 0;
  private totalFailures: number = 0;
  
  constructor(private options: CircuitBreakerOptions) {
    super();
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;
    
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        throw new CircuitOpenError(`Circuit breaker ${this.options.name} is OPEN`);
      }
      this.state = CircuitState.HALF_OPEN;
      this.emit('halfOpen', this.getStats());
    }

    try {
      const result = await this.executeWithTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new TimeoutError(`Circuit breaker ${this.options.name} timeout`));
      }, this.options.timeout);

      fn()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private onSuccess(): void {
    this.lastSuccess = new Date();
    this.successes++;

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.successes >= this.options.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.emit('closed', this.getStats());
      }
    } else {
      this.failures = 0;
    }
  }

  private onFailure(error: unknown): void {
    this.lastFailure = new Date();
    this.failures++;
    this.totalFailures++;
    this.successes = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.options.resetTimeout;
      this.emit('open', this.getStats(), error);
    } else if (this.failures >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.options.resetTimeout;
      this.emit('open', this.getStats(), error);
    }
  }

  getStats(): CircuitBreakerStats {
    return {
      name: this.options.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures
    };
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.emit('reset', this.getStats());
  }

  getState(): CircuitState {
    return this.state;
  }

  isOpen(): boolean {
    return this.state === CircuitState.OPEN;
  }
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

const circuitBreakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
  if (!circuitBreakers.has(name)) {
    const defaultOptions: CircuitBreakerOptions = {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 10000,
      resetTimeout: 30000,
      name,
      ...options
    };
    const breaker = new CircuitBreaker(defaultOptions);
    
    breaker.on('open', (stats) => {
      console.warn(`[CircuitBreaker] ${name} OPENED - failures: ${stats.failures}`);
    });
    breaker.on('closed', (_stats) => {
      logInfo(`[CircuitBreaker] ${name} CLOSED - recovered`);
    });
    breaker.on('halfOpen', (_stats) => {
      logInfo(`[CircuitBreaker] ${name} HALF_OPEN - testing connection`);
    });
    
    circuitBreakers.set(name, breaker);
  }
  return circuitBreakers.get(name)!;
}

export function getAllCircuitBreakerStats(): CircuitBreakerStats[] {
  return Array.from(circuitBreakers.values()).map(cb => cb.getStats());
}

export function resetCircuitBreaker(name: string): boolean {
  const cb = circuitBreakers.get(name);
  if (cb) {
    cb.reset();
    logInfo(`[CircuitBreaker] ${name} manually reset`);
    return true;
  }
  return false;
}

export function resetAllCircuitBreakers(): string[] {
  const reset: string[] = [];
  const entries = Array.from(circuitBreakers.entries());
  for (const [name, cb] of entries) {
    cb.reset();
    reset.push(name);
  }
  logInfo(`[CircuitBreaker] Reset all: ${reset.join(', ')}`);
  return reset;
}
