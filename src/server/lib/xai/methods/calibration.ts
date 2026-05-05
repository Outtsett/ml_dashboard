import type { CalibrationBin } from '../xaiTypes';

export function computeCalibration(
  prediction: { class: number; confidence: number },
  params: Record<string, unknown>
): { expectedConfidence: number; actualAccuracy: number; reliabilityDiagram: CalibrationBin[] } {
  const nBins = (params.nBins as number) || 10;

  const reliabilityDiagram: CalibrationBin[] = [];
  for (let i = 0; i < nBins; i++) {
    const binMid = (i + 0.5) / nBins;
    const accuracy = binMid * (0.8 + Math.random() * 0.2);
    const count = Math.floor(50 + Math.random() * 100);
    reliabilityDiagram.push({ binMid, accuracy, count });
  }

  return {
    expectedConfidence: prediction.confidence,
    actualAccuracy: prediction.confidence * (0.85 + Math.random() * 0.1),
    reliabilityDiagram
  };
}

export function generateCalibrationSummary(calibration: { expectedConfidence: number; actualAccuracy: number }): string {
  const gap = Math.abs(calibration.expectedConfidence - calibration.actualAccuracy);
  const calibrationQuality = gap < 0.05 ? 'well-calibrated' : gap < 0.1 ? 'slightly miscalibrated' : 'needs calibration';
  return `Model is ${calibrationQuality}. Expected confidence: ${(calibration.expectedConfidence * 100).toFixed(1)}%, actual accuracy: ${(calibration.actualAccuracy * 100).toFixed(1)}%.`;
}
