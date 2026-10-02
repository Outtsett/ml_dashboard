import { useState, useEffect } from "react";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { Separator } from "@/shared/ui/separator";
import { Checkbox } from "@/shared/ui/checkbox";
import { Loader2 } from "lucide-react";
import { ServerConfig, Preferences, AVAILABLE_TIMEFRAMES } from "@/system/types";

interface TrainingSettingsTabProps {
  config?: ServerConfig;
  preferences?: Preferences;
  getPref: (key: string, fallback?: unknown) => unknown;
  savePreference: (key: string, value: unknown, category: string) => void;
  saving: boolean;
}

export function TrainingSettingsTab({
  config,
  getPref,
  savePreference,
  saving,
}: TrainingSettingsTabProps) {
  const training = config?.training;
  const [pythonExe, setPythonExe] = useState("");
  const [maxJobs, setMaxJobs] = useState("");
  const [maxDuration, setMaxDuration] = useState("");
  const [selectedTimeframes, setSelectedTimeframes] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized || !training) return;
    setPythonExe((getPref("training.pythonExe", training.pythonExe) as string) || training.pythonExe);
    setMaxJobs(String(getPref("training.maxConcurrentJobs", training.maxConcurrentJobs) ?? training.maxConcurrentJobs));
    setMaxDuration(String(getPref("training.maxDurationSec", training.maxTrainingDurationSec) ?? training.maxTrainingDurationSec));
    const savedTf = getPref("training.defaultTimeframes", []) as string[];
    setSelectedTimeframes(savedTf.length > 0 ? savedTf : ["5", "15", "60", "240"]);
    setInitialized(true);
  }, [training, initialized, getPref]);

  const toggleTimeframe = (value: string) => {
    setSelectedTimeframes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const handleSave = () => {
    savePreference("training.pythonExe", pythonExe, "training");
    savePreference("training.maxConcurrentJobs", parseInt(maxJobs) || 1, "training");
    savePreference("training.maxDurationSec", parseInt(maxDuration) || 7200, "training");     
    savePreference("training.defaultTimeframes", selectedTimeframes, "training");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Training Configuration</CardTitle>
        <CardDescription>
          Configure Python environment and training job limits.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="pythonExe">Python Executable Path</Label>
          <Input
            id="pythonExe"
            value={pythonExe}
            onChange={(e) => setPythonExe(e.target.value)}
            placeholder=".venv/Scripts/python.exe"
          />
          <p className="text-xs text-muted-foreground">
            Path to the Python interpreter used for training scripts.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="maxJobs">Max Concurrent Jobs</Label>
            <Input
              id="maxJobs"
              type="number"
              min={1}
              max={16}
              value={maxJobs}
              onChange={(e) => setMaxJobs(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maxDuration">Max Training Duration (seconds)</Label>
            <Input
              id="maxDuration"
              type="number"
              min={60}
              value={maxDuration}
              onChange={(e) => setMaxDuration(e.target.value)}
            />
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <Label>Default Timeframes</Label>
          <div className="flex flex-wrap gap-3">
            {AVAILABLE_TIMEFRAMES.map((tf) => (
              <div key={tf.value} className="flex items-center gap-2">
                <Checkbox
                  id={`tf-${tf.value}`}
                  checked={selectedTimeframes.includes(tf.value)}
                  onCheckedChange={() => toggleTimeframe(tf.value)}
                />
                <Label htmlFor={`tf-${tf.value}`} className="text-sm font-normal cursor-pointer">
                  {tf.label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Training Settings
          </Button>
          {training && (
            <span className="text-xs text-muted-foreground">
              Server default: {training.maxConcurrentJobs} job(s), {training.maxTrainingDurationSec}s max
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
