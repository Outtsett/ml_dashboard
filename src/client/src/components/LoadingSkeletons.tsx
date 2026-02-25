import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48 bg-white/5" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 bg-white/5" />
          <Skeleton className="h-9 w-24 bg-white/5" />
        </div>
      </div>
      <div className="grid grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 bg-white/5 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <Skeleton className="h-80 bg-white/5 rounded-xl" />
        </div>
        <Skeleton className="h-80 bg-white/5 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-6">
        <Skeleton className="h-64 bg-white/5 rounded-xl" />
        <Skeleton className="h-64 bg-white/5 rounded-xl" />
      </div>
    </div>
  );
}

export function DataGridSkeleton() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-36 bg-white/5" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32 bg-white/5" />
          <Skeleton className="h-9 w-32 bg-white/5" />
        </div>
      </div>
      <Skeleton className="h-[500px] bg-white/5 rounded-xl" />
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-32 bg-white/5" />
        <Skeleton className="h-8 w-24 bg-white/5" />
      </div>
      <div className="relative h-[400px] bg-white/5 rounded-xl overflow-hidden">
        <div className="absolute inset-0 flex items-end justify-around px-4 pb-8">
          {Array.from({ length: 20 }).map((_, i) => (
            <Skeleton
              key={i}
              className="w-3 bg-white/10"
              style={{ height: `${20 + Math.random() * 60}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function MLHubSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40 bg-white/5" />
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-20 bg-white/5 rounded-lg" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 bg-white/5 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <Skeleton className="h-72 bg-white/5 rounded-xl" />
        <Skeleton className="h-72 bg-white/5 rounded-xl" />
      </div>
      <Skeleton className="h-64 bg-white/5 rounded-xl" />
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="flex gap-4 p-3 bg-white/5 rounded-lg">
        <Skeleton className="h-4 w-24 bg-white/10" />
        <Skeleton className="h-4 w-32 bg-white/10" />
        <Skeleton className="h-4 w-20 bg-white/10" />
        <Skeleton className="h-4 flex-1 bg-white/10" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 p-3">
          <Skeleton className="h-4 w-24 bg-white/5" />
          <Skeleton className="h-4 w-32 bg-white/5" />
          <Skeleton className="h-4 w-20 bg-white/5" />
          <Skeleton className="h-4 flex-1 bg-white/5" />
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-4 bg-white/5 rounded-xl space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full bg-white/10" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-3/4 bg-white/10" />
              <Skeleton className="h-3 w-1/2 bg-white/5" />
            </div>
          </div>
          <Skeleton className="h-20 w-full bg-white/5 rounded-lg" />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-16 bg-white/10 rounded-full" />
            <Skeleton className="h-6 w-16 bg-white/10 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="relative">
        <div className="w-16 h-16 border-4 border-primary/20 rounded-full" />
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin absolute inset-0" />
      </div>
    </div>
  );
}

export function InlineLoader({ text = "Loading..." }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <div className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
      <span className="text-sm">{text}</span>
    </div>
  );
}
