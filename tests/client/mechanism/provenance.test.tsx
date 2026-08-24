// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ProvenancePanel } from '@/system/architecture-explorer/mechanism/ProvenancePanel';
import { RepoRunnerBanner } from '@/system/architecture-explorer/mechanism/RepoRunnerBanner';
import type { MechanismSpec } from '@/system/architecture-explorer/mechanism/registry';
import type { MechanismData } from '@/system/architecture-explorer/mechanism/data/useMechanismBars';

const SPEC: MechanismSpec = {
  catalogKey: 'k-means-clustering',
  name: 'K-Means Clustering',
  archetype: 'cluster-loop',
  provenance: 'analytic',
  specPath: 'Machine Learning/Unsupervised Learning/Clustering/K-Means Clustering.md',
  analogy: 'Sorting bars into k moods.',
  stages: [
    { id: 'points', role: 'input', label: 'Feature points' },
    { id: 'assign', role: 'transform', label: 'Assign' },
  ],
  beats: [{ id: 'hard', at: 'assign', label: 'hard assignment', detail: 'One cluster each.' }],
  repoRunner: { templateId: 'none', note: 'Browse-only catalog spec — nothing would train.' },
  kernelId: 'kmeans',
};

const DATA: MechanismData = {
  bars: [],
  features: {
    columns: ['body_norm'],
    rows: [{ timestamp: 1_700_000_000, values: [0.1] }],
    warmup: 100,
  },
  ready: true,
  warmupNeeded: 100,
  barCount: 340,
  firstTimestamp: 1_700_000_000,
  lastTimestamp: 1_700_020_000,
};

afterEach(cleanup);

describe('ProvenancePanel', () => {
  it('states the real bar count and symbol', () => {
    render(<ProvenancePanel spec={SPEC} data={DATA} symbol="MNQ" timeframeLabel="1m" />);
    expect(screen.getByText(/340 real bars/)).toBeTruthy();
    expect(screen.getByText(/MNQ/)).toBeTruthy();
  });

  it('names the provenance tier', () => {
    render(<ProvenancePanel spec={SPEC} data={DATA} symbol="MNQ" timeframeLabel="1m" />);
    expect(screen.getByText('analytic')).toBeTruthy();
  });

  it('cites the spec path', () => {
    render(<ProvenancePanel spec={SPEC} data={DATA} symbol="MNQ" timeframeLabel="1m" />);
    expect(screen.getByText(/K-Means Clustering\.md/)).toBeTruthy();
  });

  it('discloses how many bars the causal warmup held back', () => {
    render(<ProvenancePanel spec={SPEC} data={DATA} symbol="MNQ" timeframeLabel="1m" />);
    expect(screen.getByText(/100 bars held back/)).toBeTruthy();
  });

  it('never claims a prediction for a seeded panel', () => {
    const seeded: MechanismSpec = { ...SPEC, provenance: 'seeded' };
    render(<ProvenancePanel spec={seeded} data={DATA} symbol="MNQ" timeframeLabel="1m" />);
    expect(screen.getByText(/not a prediction/i)).toBeTruthy();
  });

  it('shows the live optimizer readout when one is supplied', () => {
    render(
      <ProvenancePanel
        spec={SPEC}
        data={DATA}
        symbol="MNQ"
        timeframeLabel="1m"
        liveMetric={{ label: 'inertia', value: '12.345' }}
      />,
    );
    expect(screen.getByText(/inertia 12\.345/)).toBeTruthy();
  });
});

describe('RepoRunnerBanner', () => {
  it('states the divergence when repoRunner is set', () => {
    render(<RepoRunnerBanner spec={SPEC} />);
    expect(screen.getByText(/nothing would train/)).toBeTruthy();
  });

  it('names the template that would actually run', () => {
    const mlp: MechanismSpec = {
      ...SPEC,
      repoRunner: { templateId: 'pytorch_mlp', note: 'Renders the generic template.' },
    };
    render(<RepoRunnerBanner spec={mlp} />);
    expect(screen.getByText(/pytorch_mlp/)).toBeTruthy();
  });

  it('renders nothing when the repo would train this architecture', () => {
    const { container } = render(
      <RepoRunnerBanner spec={{ ...SPEC, repoRunner: null }} />,
    );
    expect(container.textContent).toBe('');
  });
});
