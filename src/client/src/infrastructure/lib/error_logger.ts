type ErrorHandler = (component: string, message: string, context?: Record<string, unknown>) => void;
let customHandler: ErrorHandler | undefined;

export function setErrorHandler(handler: ErrorHandler | undefined): void {
  customHandler = handler;
}

export function logError(component: string, message: string, context?: Record<string, unknown>): void {
  console.error(`[${component}] ${message}`, context ?? '');
  customHandler?.(component, message, context);
}

export function logWarn(component: string, message: string, context?: Record<string, unknown>): void {
  console.warn(`[${component}] ${message}`, context ?? '');
}
