import { setup, assign } from 'xstate';

// ── Constants ────────────────────────────────────────────────
export const DEPLOYMENT_STEPS = [
  'idle',
  'validating_benchmarks',
  'promoting',
  'monitoring',
  'active',
] as const;

export type DeploymentStep = (typeof DEPLOYMENT_STEPS)[number];

// ── Context ──────────────────────────────────────────────────
export interface DeploymentContext {
  pipelineId: string;
  config: Record<string, unknown>;
  completedSteps: string[];
  stepResults: Record<string, Record<string, unknown>>;
  currentStep: string;
  error: string | null;
  startedAt: number;
}

// ── Events ───────────────────────────────────────────────────
type DeploymentMachineEvents =
  | { type: 'START'; pipelineId: string; config: Record<string, unknown> }
  | { type: 'STEP_COMPLETED'; result: Record<string, unknown> }
  | { type: 'STEP_FAILED'; error: string }
  | { type: 'COMPENSATE' }
  | { type: 'COMPENSATION_DONE' };

// ── Machine ──────────────────────────────────────────────────
export const deploymentMachine = setup({
  types: {
    context: {} as DeploymentContext,
    events: {} as DeploymentMachineEvents,
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
      currentStep: () => 'validating_benchmarks' as string,
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
    advanceToPromoting: assign({ currentStep: () => 'promoting' as string }),
    advanceToMonitoring: assign({ currentStep: () => 'monitoring' as string }),
    advanceToActive: assign({ currentStep: () => 'active' as string }),
    assignError: assign({
      error: ({ event }) => {
        if (event.type !== 'STEP_FAILED') return null;
        return event.error;
      },
    }),
  },
}).createMachine({
  id: 'deploymentPipeline',
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
          target: 'validating_benchmarks',
          actions: ['assignStart'],
        },
      },
    },

    validating_benchmarks: {
      on: {
        STEP_COMPLETED: {
          target: 'promoting',
          actions: ['assignStepCompleted', 'advanceToPromoting'],
        },
        STEP_FAILED: {
          target: 'failed',
          actions: ['assignError'],
        },
      },
    },

    promoting: {
      on: {
        STEP_COMPLETED: {
          target: 'monitoring',
          actions: ['assignStepCompleted', 'advanceToMonitoring'],
        },
        STEP_FAILED: {
          target: 'failed',
          actions: ['assignError'],
        },
      },
    },

    monitoring: {
      on: {
        STEP_COMPLETED: {
          target: 'active',
          actions: ['assignStepCompleted', 'advanceToActive'],
        },
        STEP_FAILED: {
          target: 'failed',
          actions: ['assignError'],
        },
      },
    },

    active: {
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
