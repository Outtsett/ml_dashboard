import { setup, assign } from 'xstate';

// ── Constants ────────────────────────────────────────────────
export const TRAINING_STEPS = [
  'idle',
  'ingesting',
  'computing_features',
  'generating_labels',
  'training',
  'evaluating',
  'registering',
  'completed',
] as const;

export type TrainingStep = (typeof TRAINING_STEPS)[number];

// ── Context ──────────────────────────────────────────────────
export interface TrainingContext {
  pipelineId: string;
  config: Record<string, unknown>;
  completedSteps: string[];
  stepResults: Record<string, Record<string, unknown>>;
  currentStep: string;
  error: string | null;
  startedAt: number;
  pausedAt: string; // state to resume to
}

// ── Events ───────────────────────────────────────────────────
type TrainingMachineEvents =
  | { type: 'START'; pipelineId: string; config: Record<string, unknown> }
  | { type: 'STEP_COMPLETED'; result: Record<string, unknown> }
  | { type: 'STEP_FAILED'; error: string }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'COMPENSATE' }
  | { type: 'COMPENSATION_DONE' };

// ── Machine ──────────────────────────────────────────────────
export const trainingMachine = setup({
  types: {
    context: {} as TrainingContext,
    events: {} as TrainingMachineEvents,
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
      currentStep: () => 'ingesting' as string,
      startedAt: () => Date.now(),
      completedSteps: () => [] as string[],
      stepResults: () => ({}) as Record<string, Record<string, unknown>>,
      error: () => null as string | null,
      pausedAt: () => '',
    }),
    assignStepCompleted: assign({
      completedSteps: ({ context }) => [...context.completedSteps, context.currentStep],
      stepResults: ({ context, event }) => {
        if (event.type !== 'STEP_COMPLETED') return context.stepResults;
        return { ...context.stepResults, [context.currentStep]: event.result };
      },
    }),
    advanceToComputingFeatures: assign({ currentStep: () => 'computing_features' as string }),
    advanceToGeneratingLabels: assign({ currentStep: () => 'generating_labels' as string }),
    advanceToTraining: assign({ currentStep: () => 'training' as string }),
    advanceToEvaluating: assign({ currentStep: () => 'evaluating' as string }),
    advanceToRegistering: assign({ currentStep: () => 'registering' as string }),
    advanceToCompleted: assign({ currentStep: () => 'completed' as string }),
    assignError: assign({
      error: ({ event }) => {
        if (event.type !== 'STEP_FAILED') return null;
        return event.error;
      },
    }),
    assignPausedAtTraining: assign({ pausedAt: () => 'training' }),
  },
  guards: {
    pausedAtTraining: ({ context }) => context.pausedAt === 'training',
  },
}).createMachine({
  id: 'trainingPipeline',
  initial: 'idle',
  context: {
    pipelineId: '',
    config: {},
    completedSteps: [],
    stepResults: {},
    currentStep: 'idle',
    error: null,
    startedAt: 0,
    pausedAt: '',
  },
  states: {
    idle: {
      on: {
        START: {
          target: 'ingesting',
          actions: ['assignStart'],
        },
      },
    },

    ingesting: {
      on: {
        STEP_COMPLETED: {
          target: 'computing_features',
          actions: ['assignStepCompleted', 'advanceToComputingFeatures'],
        },
        STEP_FAILED: {
          target: 'failed',
          actions: ['assignError'],
        },
      },
    },

    computing_features: {
      on: {
        STEP_COMPLETED: {
          target: 'generating_labels',
          actions: ['assignStepCompleted', 'advanceToGeneratingLabels'],
        },
        STEP_FAILED: {
          target: 'failed',
          actions: ['assignError'],
        },
      },
    },

    generating_labels: {
      on: {
        STEP_COMPLETED: {
          target: 'training',
          actions: ['assignStepCompleted', 'advanceToTraining'],
        },
        STEP_FAILED: {
          target: 'failed',
          actions: ['assignError'],
        },
      },
    },

    training: {
      on: {
        STEP_COMPLETED: {
          target: 'evaluating',
          actions: ['assignStepCompleted', 'advanceToEvaluating'],
        },
        STEP_FAILED: {
          target: 'failed',
          actions: ['assignError'],
        },
        PAUSE: {
          target: 'paused',
          actions: ['assignPausedAtTraining'],
        },
      },
    },

    evaluating: {
      on: {
        STEP_COMPLETED: {
          target: 'registering',
          actions: ['assignStepCompleted', 'advanceToRegistering'],
        },
        STEP_FAILED: {
          target: 'failed',
          actions: ['assignError'],
        },
      },
    },

    registering: {
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

    paused: {
      on: {
        RESUME: {
          guard: 'pausedAtTraining',
          target: 'training',
        },
      },
    },
  },
});
