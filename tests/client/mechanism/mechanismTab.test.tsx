// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MechanismTab } from '@/system/architecture-explorer/mechanism/MechanismTab';

// The tab must render its refusal states without any network at all.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('offline in test');
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('MechanismTab', () => {
  it('renders without throwing before any data arrives', () => {
    expect(() => wrap(<MechanismTab />)).not.toThrow();
  });

  it('states plainly when the selected model has not been researched', () => {
    wrap(<MechanismTab initialCatalogKey="__unresearched__" />);
    expect(screen.getByText(/not yet researched/i)).toBeTruthy();
  });

  it('never substitutes another model for an unresearched key', () => {
    const { container } = wrap(<MechanismTab initialCatalogKey="__unresearched__" />);
    // The picker legitimately lists every catalog model, so the guarantee is
    // about the CANVAS: no sketch is mounted, and no other model's beats,
    // analogy, provenance or citation are rendered in its place.
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.queryByText(/hard assignment/i)).toBeNull();
    expect(screen.queryByText(/\.md$/)).toBeNull();
    expect(screen.queryByText(/analytic/)).toBeNull();
  });

  it('shows the divergence banner for a researched browse-only model', () => {
    wrap(<MechanismTab initialCatalogKey="k-means-clustering" />);
    expect(screen.getByText(/no runner for it/i)).toBeTruthy();
  });

  it('surfaces the researched beats for the selected model', () => {
    wrap(<MechanismTab initialCatalogKey="k-means-clustering" />);
    expect(screen.getByText(/hard assignment/i)).toBeTruthy();
    expect(screen.getByText(/spherical assumption/i)).toBeTruthy();
  });

  it('cites the spec the account was researched from', () => {
    wrap(<MechanismTab initialCatalogKey="k-means-clustering" />);
    expect(screen.getByText(/K-Means Clustering\.md/)).toBeTruthy();
  });
});
