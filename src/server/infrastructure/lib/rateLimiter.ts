import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
  skipFailedRequests?: boolean;
  onLimitReached?: (req: Request) => void;
}

const rateLimitStore: Map<string, RateLimitEntry> = new Map();

function cleanupStore(): void {
  const now = Date.now();
  for (const [key, entry] of Array.from(rateLimitStore)) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

setInterval(cleanupStore, 60000);

export function createRateLimiter(config: RateLimitConfig) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = (req) => req.ip || 'unknown',
    skipFailedRequests = false,
    onLimitReached
  } = config;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGenerator(req);
    const now = Date.now();
    
    let entry = rateLimitStore.get(key);
    
    if (!entry || now > entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + windowMs
      };
      rateLimitStore.set(key, entry);
    }
    
    entry.count++;
    
    const remaining = Math.max(0, maxRequests - entry.count);
    const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);
    
    res.setHeader('X-RateLimit-Limit', maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    res.setHeader('X-RateLimit-Reset', resetSeconds.toString());
    
    if (entry.count > maxRequests) {
      if (onLimitReached) {
        onLimitReached(req);
      }
      
      res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${resetSeconds} seconds.`,
        retryAfter: resetSeconds
      });
      return;
    }
    
    if (skipFailedRequests) {
      res.on('finish', () => {
        if (res.statusCode >= 400 && entry) {
          entry.count--;
        }
      });
    }
    
    next();
  };
}

export const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 100,
  keyGenerator: (req) => `api:${req.ip || 'unknown'}`
});

export const uploadRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 30,
  keyGenerator: (req) => `upload:${req.ip || 'unknown'}`,
  skipFailedRequests: true,
  onLimitReached: (req) => {
    console.warn(`[RateLimit] Upload limit reached for ${req.ip}`);
  }
});

export const queryRateLimiter = createRateLimiter({
  windowMs: 10 * 1000,
  maxRequests: 50,
  keyGenerator: (req) => `query:${req.ip || 'unknown'}`
});

export const mlRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  keyGenerator: (req) => `ml:${req.ip || 'unknown'}`
});

export function getRateLimitStats(): {
  activeKeys: number;
  entries: Array<{ key: string; count: number; resetIn: number }>;
} {
  const now = Date.now();
  const entries: Array<{ key: string; count: number; resetIn: number }> = [];
  
  for (const [key, entry] of Array.from(rateLimitStore)) {
    if (now <= entry.resetTime) {
      entries.push({
        key,
        count: entry.count,
        resetIn: Math.ceil((entry.resetTime - now) / 1000)
      });
    }
  }
  
  return {
    activeKeys: entries.length,
    entries
  };
}

// Re-export shared symbol validation for convenience
export { validateSymbol } from "@shared/schema";

const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
const VALID_IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_]{0,100}$/;

export function validateTableName(name: string): string {
  const trimmed = name.trim();
  if (!VALID_TABLE_NAME.test(trimmed)) {
    throw new ValidationError(`Invalid table name: ${name}`);
  }
  return trimmed;
}

export function validateIdentifier(id: string): string {
  const trimmed = id.trim();
  if (!VALID_IDENTIFIER.test(trimmed)) {
    throw new ValidationError(`Invalid identifier: ${id}`);
  }
  return trimmed;
}

export function validatePositiveInt(value: unknown, name: string, max: number = 1000000): number {
  const num = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  if (isNaN(num) || !Number.isInteger(num) || num < 0 || num > max) {
    throw new ValidationError(`Invalid ${name}: must be integer between 0 and ${max}`);
  }
  return num;
}

export function validateTimestamp(value: unknown, name: string): number {
  const num = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  if (isNaN(num) || num < 0 || num > Date.now() + 86400000 * 365) {
    throw new ValidationError(`Invalid ${name}: must be a valid timestamp`);
  }
  return num;
}

export function validateEnum<T extends string>(value: string, allowed: T[], name: string): T {
  if (!allowed.includes(value as T)) {
    throw new ValidationError(`Invalid ${name}: must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validationErrorHandler(err: Error, req: Request, res: Response, next: NextFunction): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
}
