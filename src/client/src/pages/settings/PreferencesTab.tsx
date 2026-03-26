import { useState, useEffect } from "react";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { AVAILABLE_TIMEFRAMES } from "./types";

interface PreferencesTabProps {
  getPref: (key: string, fallback?: unknown) => unknown;
  savePreference: (key: string, value: unknown, category: string) => void;
  saving: boolean;
}

export function PreferencesTab({
  getPref,
  savePreference,
  saving,
}: PreferencesTabProps) {
  const [theme, setTheme] = useState((getPref("ui.theme", "dark") as string) || "dark");      
  const [defaultTimeframe, setDefaultTimeframe] = useState(
    (getPref("ui.defaultChartTimeframe", "15") as string) || "15"
  );
  const [refreshInterval, setRefreshInterval] = useState(
    String(getPref("ui.refreshInterval", 30) ?? 30)
  );
  const [notifyTrainingComplete, setNotifyTrainingComplete] = useState(
    (getPref("ui.notifyTrainingComplete", true) as boolean)
  );
  const [notifyConnectionLost, setNotifyConnectionLost] = useState(
    (getPref("ui.notifyConnectionLost", true) as boolean)
  );

  // Zoom control
  const [zoomLevel, setZoomLevel] = useState(100);
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.getZoom) {
      api.getZoom().then((z: number) => setZoomLevel(Math.round(z * 100)));
    }
  }, []);
  const applyZoom = (pct: number) => {
    const clamped = Math.max(50, Math.min(200, pct));
    setZoomLevel(clamped);
    const api = (window as any).electronAPI;
    if (api?.setZoom) api.setZoom(clamped / 100);
  };

  const handleSave = () => {
    savePreference("ui.theme", theme, "ui");
    savePreference("ui.defaultChartTimeframe", defaultTimeframe, "ui");
    savePreference("ui.refreshInterval", parseInt(refreshInterval) || 30, "ui");
    savePreference("ui.notifyTrainingComplete", notifyTrainingComplete, "ui");
    savePreference("ui.notifyConnectionLost", notifyConnectionLost, "ui");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">UI Preferences</CardTitle>
        <CardDescription>Customize the dashboard appearance and behavior.</CardDescription>   
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Theme</Label>
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger>
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Default Chart Timeframe</Label>
            <Select value={defaultTimeframe} onValueChange={setDefaultTimeframe}>
              <SelectTrigger>
                <SelectValue placeholder="Select timeframe" />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf.value} value={tf.value}>
                    {tf.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Display Zoom ({zoomLevel}%)</Label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="px-2 py-1 text-sm rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
              onClick={() => applyZoom(zoomLevel - 10)}
            >−</button>
            <input
              type="range"
              min={50}
              max={200}
              step={5}
              value={zoomLevel}
              onChange={(e) => applyZoom(parseInt(e.target.value))}
              className="flex-1 accent-emerald-500"
            />
            <button
              type="button"
              className="px-2 py-1 text-sm rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
              onClick={() => applyZoom(zoomLevel + 10)}
            >+</button>
            <button
              type="button"
              className="px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
              onClick={() => applyZoom(100)}
            >Reset</button>
          </div>
          <p className="text-xs text-muted-foreground">
            Scale the entire UI. Keyboard: Ctrl+= to zoom in, Ctrl+- to zoom out, Ctrl+0 to reset.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="refreshInterval">Data Refresh Interval (seconds)</Label>
          <Input
            id="refreshInterval"
            type="number"
            min={5}
            max={300}
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            How often to auto-refresh market data and training status. Set 0 to disable.      
          </p>
        </div>

        <Separator />

        <div className="space-y-4">
          <Label className="text-sm font-medium">Notifications</Label>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="font-normal">Training Complete</Label>
              <p className="text-xs text-muted-foreground">
                Show a notification when a training job finishes.
              </p>
            </div>
            <Switch checked={notifyTrainingComplete} onCheckedChange={setNotifyTrainingComplete} />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="font-normal">Connection Lost</Label>
              <p className="text-xs text-muted-foreground">
                Alert when database or server connection is interrupted.
              </p>
            </div>
            <Switch checked={notifyConnectionLost} onCheckedChange={setNotifyConnectionLost} />
          </div>
        </div>

        <Separator />

        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save UI Preferences
        </Button>
      </CardContent>
    </Card>
  );
}
