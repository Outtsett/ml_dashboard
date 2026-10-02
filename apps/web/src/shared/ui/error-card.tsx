import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { motion } from "framer-motion";

interface ErrorCardProps {
  title?: string;
  description?: string;
  error?: Error | null;
  onRetry?: () => void;
  className?: string;
}

export function ErrorCard({
  title = "Something went wrong",
  description = "Failed to load data. Please try again.",
  error,
  onRetry,
  className = "",
}: ErrorCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col items-center justify-center p-8 text-center ${className}`}
    >
      <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-1 max-w-sm">{description}</p>
      {error?.message && (
        <p className="text-xs text-muted-foreground/60 font-mono mb-4 max-w-md truncate">
          {error.message.slice(0, 150)}
        </p>
      )}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-2 mt-2">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      )}
    </motion.div>
  );
}
