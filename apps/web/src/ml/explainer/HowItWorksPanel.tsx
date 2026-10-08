/**
 * HowItWorksPanel — a catalog model in plain words.
 *
 * What: the model's explainer (`GET /api/model-catalog/:id/explainer`) drawn
 * as a stepper. The steps are on the left; the worked example on the right
 * follows the selected step, from the information that goes in to what comes
 * out. Below: what to use the model for, and when to reach for another one.
 *
 * The worked example is an illustration of the model's input and output. It
 * is not a measured run; measured results are in the Runs panel.
 */

import { useState } from "react";
import { ArrowDown, ChevronLeft, ChevronRight, Lightbulb, RotateCcw, Target, TriangleAlert } from "lucide-react";
import type { ExplainerField, ModelExplainer } from "@shared/modelExplainer";
import { useModelExplainer } from "@/ml/lib/useModelCatalog";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/utils/utils";

// Okabe-Ito: the three roles are also named in words on every card.
const INPUT_COLOR = "#56B4E9";
const STEP_COLOR = "#E69F00";
const OUTPUT_COLOR = "#009E73";

export function HowItWorksPanel({ specificationId, name }: { specificationId: string; name: string }) {
  const { data: explainer, isLoading, isError, error } = useModelExplainer(specificationId);

  if (isLoading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError) {
    return <p className="p-6 text-sm text-muted-foreground">The explainer for {name} could not be read: {(error as Error).message}</p>;
  }
  if (!explainer) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {name} is a trained model or a run record, so it has no step-by-step explainer of its own. Explainers are written for the catalog's
        model specifications; this entry's details are in the Blueprint and Runs tabs.
      </p>
    );
  }
  // Keyed by model so the stepper starts at step 1 when another model is opened.
  return <Explainer key={explainer.specificationId} explainer={explainer} />;
}

function Explainer({ explainer }: { explainer: ModelExplainer }) {
  const [stepIndex, setStepIndex] = useState(0);
  const lastIndex = explainer.steps.length - 1;
  const step = explainer.steps[stepIndex]!;

  return (
    <div className="space-y-6 p-6">
      {/* The model as something familiar */}
      <section className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-4">
        <Lightbulb className="mt-0.5 h-5 w-5 shrink-0" style={{ color: STEP_COLOR }} />
        <p className="text-sm leading-relaxed text-foreground">{explainer.analogy}</p>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Step by step */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold font-display">How it works, step by step</h3>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={stepIndex === 0}
                onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
              >
                <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <span className="w-20 text-center font-mono text-xs text-muted-foreground" data-testid="explainer-step-counter">
                step {stepIndex + 1} of {explainer.steps.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={stepIndex === lastIndex}
                onClick={() => setStepIndex((index) => Math.min(lastIndex, index + 1))}
              >
                Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" title="Back to step 1" onClick={() => setStepIndex(0)}>
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <ol className="space-y-2">
            {explainer.steps.map((item, index) => {
              const isCurrent = index === stepIndex;
              const isDone = index < stepIndex;
              return (
                <li key={item.title}>
                  <button
                    type="button"
                    onClick={() => setStepIndex(index)}
                    aria-current={isCurrent ? "step" : undefined}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                      isCurrent ? "bg-[#E69F00]/10" : "border-border/40 hover:bg-muted/30",
                    )}
                    style={isCurrent ? { borderColor: STEP_COLOR } : undefined}
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs",
                        isCurrent ? "font-bold text-black" : isDone ? "text-foreground" : "text-muted-foreground",
                      )}
                      style={isCurrent ? { backgroundColor: STEP_COLOR, borderColor: STEP_COLOR } : isDone ? { borderColor: STEP_COLOR } : undefined}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={cn("block text-sm font-medium", isCurrent ? "text-foreground" : "text-muted-foreground")}>{item.title}</span>
                      {isCurrent && <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{item.description}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        {/* The worked example, following the selected step */}
        <section>
          <h3 className="mb-1 text-sm font-semibold font-display">One example, from input to output</h3>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{explainer.example.scenario}</p>

          <FieldCard role="What goes in" color={INPUT_COLOR} summary={explainer.example.input.summary} fields={explainer.example.input.fields} />
          <FlowArrow />
          <div className="rounded-lg border p-3" style={{ borderColor: STEP_COLOR }} data-testid="explainer-step-in-example">
            <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: STEP_COLOR }}>
              Step {stepIndex + 1} on this example: {step.title}
            </div>
            <p className="text-sm leading-relaxed text-foreground">{step.inExample}</p>
          </div>
          <FlowArrow />
          <FieldCard
            role="What comes out"
            color={OUTPUT_COLOR}
            summary={explainer.example.output.summary}
            fields={explainer.example.output.fields}
            dimmed={stepIndex !== lastIndex}
            note={stepIndex !== lastIndex ? `Reached at step ${explainer.steps.length}.` : undefined}
          />

          <div className="mt-3 rounded-lg border border-border/40 bg-muted/20 p-3">
            <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">How to read it</div>
            <p className="text-sm leading-relaxed text-muted-foreground">{explainer.example.reading}</p>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            This example is an illustration of the kind of input the model takes and the kind of output it returns. It is not a measured run;
            the model's measured results are in the Runs tab.
          </p>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold font-display">
            <Target className="h-4 w-4" style={{ color: INPUT_COLOR }} /> What to use it for
          </h3>
          <ul className="space-y-2">
            {explainer.useFor.map((use) => (
              <li key={use.task} className="rounded-lg border border-border/40 p-3">
                <div className="text-sm font-medium text-foreground">{use.task}</div>
                <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{use.example}</div>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold font-display">
            <TriangleAlert className="h-4 w-4" style={{ color: "#CC79A7" }} /> Reach for a different model when
          </h3>
          <ul className="space-y-2">
            {explainer.avoidWhen.map((reason) => (
              <li key={reason} className="rounded-lg border border-border/40 p-3 text-sm leading-relaxed text-muted-foreground">
                {reason}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex justify-center py-1.5 text-muted-foreground">
      <ArrowDown className="h-4 w-4" />
    </div>
  );
}

function FieldCard({
  role,
  color,
  summary,
  fields,
  dimmed = false,
  note,
}: {
  role: string;
  color: string;
  summary: string;
  fields: ExplainerField[];
  dimmed?: boolean;
  note?: string;
}) {
  return (
    <div className={cn("rounded-lg border p-3 transition-opacity", dimmed && "opacity-60")} style={{ borderColor: color }}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>
          {role}
        </span>
        {note && <span className="text-[10px] text-muted-foreground">{note}</span>}
      </div>
      <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{summary}</p>
      <dl className="divide-y divide-border/30">
        {fields.map((field) => (
          <div key={field.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-1.5" title={field.meaning}>
            <dt className="text-xs text-foreground">{field.name}</dt>
            <dd className="text-right font-mono text-xs font-semibold" style={{ color }}>
              {field.value}
            </dd>
            <dd className="col-span-2 text-[11px] leading-snug text-muted-foreground">{field.meaning}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
