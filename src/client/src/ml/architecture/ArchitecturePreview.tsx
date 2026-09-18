/**
 * ArchitecturePreview — the diagram on a catalog spec's page.
 *
 * Draws the architecture the SPEC describes (its blueprint). What ML Studio
 * would actually train is a separate fact and is stated as one: several specs
 * render through a shared template, so an LSTM spec is drawn as an LSTM and
 * labelled as generating the `pytorch_mlp` runner.
 */

import { NetworkDiagram } from "./NetworkDiagram";
import { getBlueprint } from "./blueprints";

interface ArchitecturePreviewProps {
  specId: string;
  /** Template ML Studio renders for this spec; null when it cannot train it. */
  templateId: string | null;
}

export function ArchitecturePreview({ specId, templateId }: ArchitecturePreviewProps) {
  const graph = getBlueprint(specId);

  if (!graph) {
    return (
      <div
        className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground font-mono"
        data-testid="architecture-preview-missing"
      >
        No architecture blueprint has been written for this spec yet.
      </div>
    );
  }

  return (
    <section data-testid="architecture-preview" className="space-y-1.5">
      <div className="flex h-[460px] min-h-0 flex-col">
        <NetworkDiagram graph={graph} />
      </div>
      <p className="text-[11px] text-muted-foreground font-mono">
        Sized for this repo's pipeline: 35 features over a 64-bar window.
        {templateId && ` ML Studio trains this spec through the ${templateId} template, which may be a simpler network than the one drawn.`}
      </p>
    </section>
  );
}
