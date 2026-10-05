import React from 'react';
import { Card } from "@/shared/ui/card";

export function VisionAnalyticsTab({ profileId }: { profileId: string }) {
  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold text-amber-500">Computer Vision Diagnostics</h2>
      </div>
      <Card className="p-6 bg-neutral-900 border-neutral-800 flex items-center justify-center h-72">
        <div className="text-center text-neutral-500">
          <p className="mb-2">Saliency Maps & Silhouette Tracking</p>
          <p className="text-xs">Image visualization canvas is active.</p>
        </div>
      </Card>
    </div>
  );
}
