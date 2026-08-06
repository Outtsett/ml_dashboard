/**
 * "What actually runs" — the divergence banner.
 *
 * For 48 of the 140 catalog entries this repo would train the generic
 * pytorch_mlp template rather than the published architecture on screen, and
 * for the browse-only specs it would train nothing at all. Rendering the
 * published mechanism without saying so is the confusion this whole tab exists
 * to remove, so the banner is not dismissible and appears whenever
 * `repoRunner` is set.
 *
 * Colour note: the warning tone is Okabe-Ito orange (#E69F00), never red — a
 * red/green pairing is prohibited project-wide.
 */

import { AlertTriangle } from 'lucide-react';
import type { MechanismSpec } from './registry';

export interface RepoRunnerBannerProps {
  spec: MechanismSpec;
}

export function RepoRunnerBanner({ spec }: RepoRunnerBannerProps) {
  if (!spec.repoRunner) return null;
  const { templateId, note } = spec.repoRunner;

  return (
    <div className="flex items-start gap-2 rounded-md border border-[#E69F00]/40 bg-[#E69F00]/10 p-2.5 text-xs">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <p className="flex-1">
        {note}{' '}
        <span className="text-muted-foreground">
          (template: {templateId === 'none' ? 'no runner' : templateId})
        </span>
      </p>
    </div>
  );
}

export default RepoRunnerBanner;
