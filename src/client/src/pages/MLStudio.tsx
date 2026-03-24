import { useState, lazy, Suspense } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Brain, FlaskConical, AudioWaveform, Network, GraduationCap } from 'lucide-react';
import { PageLoader } from '@/components/LoadingSkeletons';
import { useBreadcrumbs } from '@/hooks/useBreadcrumbs';

// Lazy load the existing components to follow Single Responsibility Principle (SRP)
const Training = lazy(() => import('@/pages/Training'));
const Backtest = lazy(() => import('@/pages/Backtest'));
const FourierTransform = lazy(() => import('@/pages/FourierTransform'));
const ArchitectureExplorer = lazy(() => import('@/pages/ArchitectureExplorer'));
const Curriculum = lazy(() => import('@/pages/Curriculum'));

export default function MLStudio() {
  const [activeTab, setActiveTab] = useState('curriculum');

  const tabLabels: Record<string, string> = {
    curriculum: 'Curriculum',
    training: 'Training',
    backtest: 'Backtest',
    fourier: 'Fourier Analysis',
    architecture: 'Architecture',
  };

  useBreadcrumbs([{ label: tabLabels[activeTab] ?? activeTab }]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex justify-between items-center mb-4 shrink-0 px-1">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground">ML Studio</h1>      
          <p className="text-sm text-muted-foreground mt-1">Unified environment for model training, testing, and analysis</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center gap-3 shrink-0">
          <TabsList className="glass rounded-xl p-1 h-auto w-fit">
            <TabsTrigger value="curriculum" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20">
              <GraduationCap className="h-3.5 w-3.5 mr-1.5" /> Curriculum
            </TabsTrigger>
            <TabsTrigger value="training" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20">
              <Brain className="h-3.5 w-3.5 mr-1.5" /> Training
            </TabsTrigger>
            <TabsTrigger value="backtest" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20">
              <FlaskConical className="h-3.5 w-3.5 mr-1.5" /> Backtest
            </TabsTrigger>
            <TabsTrigger value="fourier" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20">
              <AudioWaveform className="h-3.5 w-3.5 mr-1.5" /> Fourier
            </TabsTrigger>
            <TabsTrigger value="architecture" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20">
              <Network className="h-3.5 w-3.5 mr-1.5" /> Architecture
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 min-h-0 overflow-auto mt-4 bg-card/10 rounded-xl p-0">
          <Suspense fallback={<PageLoader />}>
            <TabsContent value="curriculum" className="h-full m-0 data-[state=inactive]:hidden">
              <Curriculum />
            </TabsContent>
            <TabsContent value="training" className="h-full m-0 data-[state=inactive]:hidden">
              <Training />
            </TabsContent>
            <TabsContent value="backtest" className="h-full m-0 data-[state=inactive]:hidden">
              <Backtest />
            </TabsContent>
            <TabsContent value="fourier" className="h-full m-0 data-[state=inactive]:hidden"> 
              <FourierTransform />
            </TabsContent>
            <TabsContent value="architecture" className="h-full m-0 data-[state=inactive]:hidden">
              <ArchitectureExplorer />
            </TabsContent>
          </Suspense>
        </div>
      </Tabs>
    </div>
  );
}
