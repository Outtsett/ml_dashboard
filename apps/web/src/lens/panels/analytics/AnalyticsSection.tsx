/**
 * The analytics panel wired to its data: every bar of the record (loaded for
 * the evaluation's own parameters, so re-simulated trades and regimes match it)
 * and the Market chart link. The panel itself stays a pure function of props.
 */

import { useState } from "react";
import type { LensEvaluation, LensManifest } from "@shared/lens/types";
import { useToast } from "@/shared/hooks/use-toast";
import { AnalyticsPanel } from "../AnalyticsPanel";
import { useLensChartLink, useLensRecordBars } from "./hooks";

export function LensAnalyticsSection({ evaluation, manifest }: { evaluation: LensEvaluation; manifest: LensManifest }) {
  const { toast } = useToast();
  const record = useLensRecordBars(manifest.modelId, evaluation.params, manifest.barCount);
  const { show, clear } = useLensChartLink();
  const [message, setMessage] = useState<string | null>(null);

  const onError = (title: string) => (error: Error) => {
    setMessage(`${title}: ${error.message}`);
    toast({ title, description: error.message, variant: "destructive" });
  };

  return (
    <AnalyticsPanel
      evaluation={evaluation}
      manifest={manifest}
      bars={record.bars}
      barsReason={record.reason}
      nowSeconds={Date.now() / 1000}
      chart={{
        onShow: (set) => show.mutate(set, { onSuccess: setMessage, onError: onError("Could not draw on the Market chart") }),
        onClear: (source) => clear.mutate(source, { onSuccess: setMessage, onError: onError("Could not clear the Market chart") }),
        busy: show.isPending || clear.isPending,
        message,
      }}
    />
  );
}
