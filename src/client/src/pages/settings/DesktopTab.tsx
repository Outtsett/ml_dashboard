import { useState, useEffect } from "react";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { 
  Monitor, 
  Command, 
  FileText, 
  ExternalLink,
  Keyboard,
  Clock
} from "lucide-react";
import { useElectron } from "@/hooks/useElectron";

interface DesktopTabProps {
  getPref: (key: string, fallback?: unknown) => unknown;
  savePreference: (key: string, value: unknown, category: string) => void;
  saving: boolean;
}

export function DesktopTab({
  getPref,
  savePreference,
  saving,
}: DesktopTabProps) {
  const api = useElectron();
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [minimizeToTray, setMinimizeToTray] = useState(
    (getPref("ui.minimizeToTray", true) as boolean)
  );

  useEffect(() => {
    if (api?.getAutoLaunch) {
      api.getAutoLaunch().then(setAutoLaunch);
    }
  }, [api]);

  const handleToggleAutoLaunch = async (enabled: boolean) => {
    if (api?.setAutoLaunch) {
      await api.setAutoLaunch(enabled);
      setAutoLaunch(enabled);
    }
  };

  const handleToggleMinimizeToTray = (enabled: boolean) => {
    setMinimizeToTray(enabled);
    savePreference("ui.minimizeToTray", enabled, "ui");
  };

  const handleOpenLogs = () => {
    api?.openLogsFolder();
  };

  const handleOpenInstallDir = async () => {
    const path = await api?.getPath("userData");
    if (path) {
      console.log("User data path:", path);
    }
  };

  const DEFAULT_SHORTCUTS = [
    { label: "Market Data", keys: "Ctrl+1" },
    { label: "ML Studio", keys: "Ctrl+2" },
    { label: "Model Catalog", keys: "Ctrl+3" },
    { label: "Portfolio", keys: "Ctrl+4" },
    { label: "Databases", keys: "Ctrl+5" },
    { label: "Watchlist", keys: "Ctrl+6" },
    { label: "Settings", keys: "Ctrl+7" },
    { label: "Toggle Sidebar", keys: "Ctrl+B" },
    { label: "Toggle Fullscreen", keys: "F11" },
    { label: "Open DevTools", keys: "F12" },
  ];

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            Native Integration
          </CardTitle>
          <CardDescription>Configure how the dashboard interacts with Windows.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Start with Windows</Label>
              <p className="text-xs text-muted-foreground">
                Automatically launch the dashboard and speed layer when you log in.
              </p>
            </div>
            <Switch 
              checked={autoLaunch} 
              onCheckedChange={handleToggleAutoLaunch}
              disabled={!api}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Minimize to Tray</Label>
              <p className="text-xs text-muted-foreground">
                Closing the window will hide it in the system tray instead of quitting.
              </p>
            </div>
            <Switch 
              checked={minimizeToTray} 
              onCheckedChange={handleToggleMinimizeToTray}
            />
          </div>

          <Separator />

          <div className="space-y-3">
            <Label className="text-sm font-medium">Application Data</Label>
            <div className="flex gap-3">
              <Button variant="outline" size="sm" onClick={handleOpenLogs} className="gap-2">
                <FileText className="h-3.5 w-3.5" />
                Open Logs Folder
              </Button>
              <Button variant="outline" size="sm" onClick={handleOpenInstallDir} className="gap-2">
                <ExternalLink className="h-3.5 w-3.5" />
                User Data Path
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Keyboard className="h-4 w-4" />
            Global Hotkeys
          </CardTitle>
          <CardDescription>Mission Control shortcuts available from any application.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2">
            {DEFAULT_SHORTCUTS.map((s) => (
              <div key={s.label} className="flex items-center justify-between py-1 border-b border-border/30 last:border-0">
                <span className="text-xs text-muted-foreground font-medium">{s.label}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-foreground/70 border border-border/50 shadow-sm">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-4 italic flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Customizable shortcuts coming in v2.5.0
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
