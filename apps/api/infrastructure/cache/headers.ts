/**
 * HTTP cache header middleware.
 *
 * Routes depend on this abstraction (DIP) — adding a new cache policy is
 * one line. No route code changes needed (OCP).
 */

import type { RequestHandler } from 'express';

export function cacheControl(maxAge: number): RequestHandler {
  return (_req, res, next) => {
    res.set('Cache-Control', `public, max-age=${maxAge}`);
    next();
  };
}

/** 1 hour — data that rarely changes (instruments, indicator catalog) */
export const CACHE_STATIC = cacheControl(3600);

/** 5 min — data that changes occasionally (symbol list, training config) */
export const CACHE_SEMI = cacheControl(300);
