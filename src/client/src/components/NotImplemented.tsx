import { Badge } from "@/components/ui/badge";
import { Construction, Database, LineChart, Brain, Zap, Clock, LucideIcon } from "lucide-react";

type FeatureType = 'data' | 'chart' | 'ml' | 'realtime' | 'general';

interface NotImplementedProps {
  feature: string;
  type?: FeatureType;
  description?: string;
  className?: string;
}

const iconMap: Record<FeatureType, LucideIcon> = {
  data: Database,
  chart: LineChart,
  ml: Brain,
  realtime: Zap,
  general: Construction,
};

export default function NotImplemented({ feature, type = 'general', description, className }: NotImplementedProps) {
  const Icon = iconMap[type];
  
  return (
    <div className={`flex items-center justify-center h-full w-full ${className || ''}`}>
      <div className="text-center space-y-3 p-6 max-w-md">
        <div className="flex justify-center">
          <div className="p-4 rounded-full bg-amber-500/10 border border-amber-500/20">
            <Icon className="h-8 w-8 text-amber-400" />
          </div>
        </div>
        <div>
          <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 mb-2">
            Not Implemented
          </Badge>
          <h3 className="text-lg font-medium text-foreground">{feature}</h3>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ 
  title, 
  description, 
  icon: Icon = Clock,
  action 
}: { 
  title: string; 
  description?: string; 
  icon?: LucideIcon;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-center h-full w-full">
      <div className="text-center space-y-3 p-6 max-w-md">
        <div className="flex justify-center">
          <div className="p-4 rounded-full bg-muted/20 border border-muted-foreground/10">
            <Icon className="h-8 w-8 text-muted-foreground" />
          </div>
        </div>
        <div>
          <h3 className="text-lg font-medium text-foreground">{title}</h3>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
        {action && <div className="pt-2">{action}</div>}
      </div>
    </div>
  );
}
