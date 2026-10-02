import { setup, assign } from 'xstate';

// ── Constants ────────────────────────────────────────────────
export const INGESTION_STEPS = [
  'idle',
  'uploading',
  'validating',
  'deduplicating',
  'ingesting_duckdb',
  'syncing_lake',
  'computing_indicators',
  'completed',
] as const;

export type IngestionStep = (typeof INGESTION_STEPS)[number];

// ── Context ──────────────────────────────────────────────────
export interface IngestionContext {
  pipelineId: string;
  config: Record<string, unknown>;
  completedSteps: string[];
  stepResults: Record<string, Record<string, unknown>>;
  currentStep: string;
  error: string | null;
  startedAt: number;
}

// ── Events ───────────────────────────────────────────────────
type IngestionMachineEvents =
  | { type: 'START'; pipelineId: string; config: Record<string, unknown> }
  | { type: 'STEP_COMPLETED'; result: Record<string, unknown> }
  | { type: 'STEP_FAILED'; error: string }
  | { type: 'COMPENSATE' }
  | { type: 'COMPENSATION_DONE' };

// ── Machine ──────────────────────────────────────────────────
export const ingestionMachine = setup({
  types: {
    context: {} as IngestionContext,
    events: {} as IngestionMachineEvents,
  },
  actions: {
    assignStart: assign({
      pipelineId: ({ event }) => {
        if (event.type !== 'START') return '';
        return event.pipelineId;
      },
      config: ({ event }) => {
        if (event.type !== 'START') return {};
        return event.config;
      },
      currentStep: () => 'uploading' as string,
      startedAt: () => Date.now(),
      completedSteps: () => [] as string[],
      stepResults: () => ({}) as Record<string, Record<string, unknown>>,
      error: () => null as string | null,
    }),
    assignStepCompleted: assign({
      completedSteps: ({ context }) => [...context.completedSteps, context.currentStep],
      stepResults: ({ context, event }) => {
        if (event.type !== 'STEP_COMPLETED') return context.stepResults;
        return { ...context.stepResults, [context.currentStep]: event.result };
      },
    }),
    advanceToValidating: assign({ currentStep: () => 'validating' as string }),
    advanceToDeduplicating: assign({ currentStep: () => 'deduplicating' as string }),
    advanceToIngestingDuckdb: assign({ currentStep: () => 'ingesting_duckdb' as string }),
    advanceToSyncinglake: assign({ currentStep: () => 'syncing_lake' as string }),
    advanceToComputingIndicators: assign({ currentStep: () => 'computing_indicators' as string }),
    advanceToCompleted: assign({ currentStep: () => 'completed' as string }),
    assignError: assign({
      error: ({ event }) => {
        if (event.type !== 'STEP_FAILED') return null;
        return event.error;
      },
    }),
  },
}).createMachine({
  id: 'ingestionPipeline',
  initial: 'idle',
  context: {
    pipelineId: '',
    config: {},
    completedSteps: [],
    stepResults: {},
    currentStep: 'idle',
    error: null,
    startedAt: 0,
  },
  states: {
    idle: {
      on: {
        START: {
          target: 'uploading',
          actions: ['assignStart'],
        },
      },
    },

    uploading: {
      on: {
        STEP_COMPLETED: {
          target: 'validating',
          actions: ['assignStepCompleted', 'advanceToValidating'],
        },
        STEP_FAILED: {
          target: 'failed',
          actions: ['assignError'],
        },
      },
    },

    validating: {
      on: {
        STEP_COMPLETED: {
          target: 'deduplicating',
          actions: ['assignStepCompleted', 'advanceToDeduplicating'],
        },
        STEP_FAILED: {
          target: 'failed',
          actions: ['assignError'],
        },
      },
    },

    deduplicating: {
      on: {
        STEP_COMPLETED: {
          target: 'ingesting_duckdb',
          actions: ['assignStepCompleted', 'advanceToIngestingDuckdb'],
        },
        STEP_FAILED: {
          target: 'failed',
          actions: ['assignError'],
        },
      },
    },

    ingesting_duckdb: {
      on: {
        STEP_COMPLETED: {
          target: 'syncing_lake',
          actions: ['assignStepCompleted', 'advanceToSyncinglake'],
        },
        STEP_FAILED: {
          target: 'failed',
          actions: ['assignError'],
        },
      },
    },

    syncing_lake: {
      on: {
        STEP_COMPLETED: {
          target: 'computing_indicators',
          actions: ['assignStepCompleted', 'advanceToComputingIndicators'],
        },
        STEP_FAILED: {
          target: 'failed',
          actions: ['assignError'],
        },
      },
    },

    computing_indicators: {
      on: {
        STEP_COMPLETED: {
          target: 'completed',
          actions: ['assignStepCompleted', 'advanceToCompleted'],
        },
        STEP_FAILED: {
          target: 'failed',
          actions: ['assignError'],
        },
      },
    },

    completed: {
      type: 'final',
    },

    failed: {
      on: {
        COMPENSATE: {
          target: 'compensating',
        },
      },
    },

    compensating: {
      on: {
        COMPENSATION_DONE: {
          target: 'compensated',
        },
      },
    },

    compensated: {
      type: 'final',
    },
  },
});

