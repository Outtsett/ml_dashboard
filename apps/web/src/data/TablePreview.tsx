import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { RefreshCw } from "lucide-react";

interface TablePreviewProps {
  tableName: string;
  data: unknown;
  isLoading: boolean;
  onClose: () => void;
}

export function TablePreview({ tableName, data, isLoading, onClose }: TablePreviewProps) {
  return (
    <Card className="glass">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="font-mono">{tableName}</CardTitle>
          <CardDescription>Preview (first 100 rows)</CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <ScrollArea className="h-[300px]">
            <pre className="text-xs font-mono text-muted-foreground">
              {JSON.stringify(data, null, 2)}
            </pre>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
