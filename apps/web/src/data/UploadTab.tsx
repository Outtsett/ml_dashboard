import { useRef } from "react";
import type { Upload as UploadRecord } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Progress } from "@/shared/ui/progress";
import { Upload, FileText, X, CheckCircle2, XCircle, Loader2, Database } from "lucide-react";
import type { FileUploadItem } from "@/shared/utils/types";

interface UploadTabProps {
  selectedFiles: FileUploadItem[];
  isUploading: boolean;
  pendingCount: number;
  uploads: UploadRecord[];
  onFilesSelected: (files: FileList | null) => void;
  onRemoveFile: (index: number) => void;
  onUpdateFileSymbol: (index: number, newSymbol: string) => void;
  onUploadAll: () => void;
  onClearCompleted: () => void;
}

export function UploadTab({
  selectedFiles,
  isUploading,
  pendingCount,
  uploads,
  onFilesSelected,
  onRemoveFile,
  onUpdateFileSymbol,
  onUploadAll,
  onClearCompleted,
}: UploadTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-display font-semibold">Upload Data</h2>
          <p className="text-sm text-muted-foreground">Upload CSV, Parquet, DBN, or JSON files to lake</p>
        </div>
        {selectedFiles.length > 0 && (
          <Button
            onClick={onUploadAll}
            disabled={pendingCount === 0 || isUploading}
            className="bg-gradient-to-r from-[hsl(var(--data-pos))] to-cyan-500 text-white hover:opacity-90"
            data-testid="button-upload-all"
          >
            {isUploading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading...</>
            ) : (
              <><Upload className="mr-2 h-4 w-4" /> Upload {pendingCount} Files</>
            )}
          </Button>
        )}
      </div>

      {/* Dropzone */}
      <Card className="glass border-2 border-dashed border-white/20 hover:border-[hsl(var(--data-pos)/0.5)] transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-[hsl(var(--data-pos))]'); }}
        onDragLeave={(e) => { e.currentTarget.classList.remove('border-[hsl(var(--data-pos))]'); }}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('border-[hsl(var(--data-pos))]');
          onFilesSelected(e.dataTransfer.files);
        }}
        data-testid="upload-dropzone"
      >
        <CardContent className="p-8 text-center">
          <Upload className="h-10 w-10 mx-auto mb-3 text-[hsl(var(--data-pos)/0.6)]" />
          <p className="text-sm font-medium text-muted-foreground">Drop files here or click to browse</p>
          <p className="text-xs text-muted-foreground/60 mt-1">CSV, Parquet, DBN, JSON (max 500MB per file)</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.zst,.parquet,.dbn,.json"
            multiple
            onChange={(e) => onFilesSelected(e.target.files)}
            className="hidden"
            data-testid="upload-file-input"
          />
        </CardContent>
      </Card>

      {/* File Queue */}
      {selectedFiles.length > 0 && (
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                File Queue
                <Badge variant="outline" className="text-xs">{selectedFiles.length}</Badge>
              </span>
              <Button variant="ghost" size="sm" onClick={onClearCompleted} className="text-xs h-7">
                Clear Completed
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {selectedFiles.map((fileItem, index) => (
              <div key={index} className={`p-3 rounded-lg flex items-center gap-3 ${
                fileItem.status === 'completed' ? 'bg-[hsl(var(--data-pos)/0.1)]' :
                fileItem.status === 'failed' ? 'bg-[hsl(var(--data-neg)/0.1)]' :
                fileItem.status === 'uploading' ? 'bg-primary/10' : 'bg-white/5'
              }`} data-testid={`upload-file-${index}`}>
                <FileText className={`h-4 w-4 shrink-0 ${
                  fileItem.status === 'completed' ? 'text-[hsl(var(--data-pos))]' :
                  fileItem.status === 'failed' ? 'text-[hsl(var(--data-neg))]' :
                  fileItem.status === 'uploading' ? 'text-primary' : 'text-muted-foreground'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono truncate">{fileItem.file.name}</p>
                  <p className="text-[10px] text-muted-foreground">{(fileItem.file.size / 1024 / 1024).toFixed(1)} MB</p>
                  {fileItem.status === 'uploading' && <Progress value={fileItem.progress} className="h-1 mt-1" />}
                </div>
                <Input
                  value={fileItem.symbol}
                  onChange={(e) => onUpdateFileSymbol(index, e.target.value)}
                  className="w-20 h-7 text-xs font-mono rounded bg-white/10 border-white/10 px-2"
                  disabled={fileItem.status !== 'pending'}
                  data-testid={`upload-symbol-${index}`}
                />
                <Badge variant="outline" className={`text-[10px] shrink-0 ${
                  fileItem.assetType === 'futures' ? 'border-violet-500/30 text-violet-400' : 'border-teal-500/30 text-teal-400'
                }`}>{fileItem.assetType}</Badge>
                {fileItem.status === 'pending' && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => onRemoveFile(index)}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
                {fileItem.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-[hsl(var(--data-pos))] shrink-0" />}
                {fileItem.status === 'failed' && <XCircle className="h-4 w-4 text-[hsl(var(--data-neg))] shrink-0" />}
                {fileItem.status === 'uploading' && <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Upload History */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Database className="h-4 w-4" />
            Upload History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {uploads.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No uploads yet</p>
          ) : (
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {uploads.map((upload) => (
                  <div key={upload.id} className="flex items-center gap-3 p-2 rounded-lg bg-white/5" data-testid={`upload-history-${upload.id}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold">{upload.symbol}</span>
                        <Badge variant="outline" className={`text-[10px] h-4 rounded-full px-1.5 ${
                          upload.status === 'completed' ? 'border-[hsl(var(--data-pos)/0.3)] text-[hsl(var(--data-pos))]' :
                          upload.status === 'processing' ? 'border-primary/30 text-primary' : 'border-[hsl(var(--data-neg)/0.3)] text-[hsl(var(--data-neg))]'
                        }`}>{upload.status}</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">{upload.filename}</p>
                    </div>
                    <span className="font-mono text-xs text-primary shrink-0">{(upload.recordCount || 0).toLocaleString()} rows</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

