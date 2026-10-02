/**
 * Forecast — top-level page wrapping the existing ForecastVisualizer.
 *
 * Promoted from the ML Studio "Forecast" sub-tab to its own route so the
 * forecast workflow doesn't require navigating into ML Studio first.
 */
import ForecastVisualizer from '@/ml/components/ForecastVisualizer';
import { useBreadcrumbs } from '@/shared/hooks/useBreadcrumbs';

export default function Forecast() {
  useBreadcrumbs([{ label: 'Forecast' }]);
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ForecastVisualizer />
    </div>
  );
}
