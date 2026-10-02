import React, { type ReactNode } from 'react';
import { QueryErrorResetBoundary } from '@tanstack/react-query';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

class InnerBoundary extends React.Component<
  Props & { onReset: () => void }, State
> {
  state: State = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error): State { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[QueryErrorBoundary]', error.message, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="text-[hsl(var(--data-neg))] font-mono text-sm">
            {this.state.error?.message ?? 'Something went wrong'}
          </div>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); this.props.onReset(); }}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-sm font-mono transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Error boundary that integrates with TanStack Query.
 * On retry, resets both the error state AND re-triggers failed queries.
 */
export function QueryErrorBoundary({ children, fallback }: Props) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => <InnerBoundary onReset={reset} fallback={fallback}>{children}</InnerBoundary>}
    </QueryErrorResetBoundary>
  );
}
