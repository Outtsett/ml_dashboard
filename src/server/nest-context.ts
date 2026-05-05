import type { INestApplicationContext } from '@nestjs/common';

/** NestJS application context — DI container + lifecycle, no HTTP handling. */
let appContext: INestApplicationContext | null = null;

/** Set the NestJS context (called once from bootstrap). */
export function setNestApp(ctx: INestApplicationContext): void {
  appContext = ctx;
}

/** Access the NestJS DI container from outside (bridge for non-NestJS code). */
export function getNestApp(): INestApplicationContext {
  if (!appContext) throw new Error('NestJS not initialized yet');
  return appContext;
}
