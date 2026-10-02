/** Create a notebook from the template in any configured folder, then open it
 *  in the editor. The name rules match the server's (template.ts): the server
 *  checks again and has the final word. */

import { useEffect, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import type { NewNotebookRequest } from "./api";
import type { RootEntry } from "./types";

const FILE_NAME_PATTERN = /^[a-z][a-z0-9_]{1,60}$/;

/** "Volume at the open" -> "volume_at_the_open": the file name a title suggests. */
export function suggestFileName(title: string): string {
  const snake = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "");
  return snake.slice(0, 60);
}

export function NewNotebookDialog({
  open,
  onOpenChange,
  roots,
  pending,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roots: RootEntry[];
  pending: boolean;
  onCreate: (request: NewNotebookRequest) => void;
}) {
  const [rootPath, setRootPath] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileNameTouched, setFileNameTouched] = useState(false);

  // Every opening starts empty: the previous title and name would otherwise
  // be offered again and fail as a file that already exists.
  useEffect(() => {
    if (!open) return;
    setRootPath("");
    setTitle("");
    setDescription("");
    setFileName("");
    setFileNameTouched(false);
  }, [open]);

  const chosenRoot = rootPath || roots[0]?.path || "";
  const effectiveFileName = fileNameTouched ? fileName : suggestFileName(title);
  const nameValid = FILE_NAME_PATTERN.test(effectiveFileName);
  const canCreate = Boolean(chosenRoot) && title.trim().length > 0 && nameValid && !pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="new-notebook-dialog">
        <DialogHeader>
          <DialogTitle>New notebook</DialogTitle>
          <DialogDescription>
            Written from the template: header cell, DuckDB on the lake (UTC), the Okabe-Ito palette, the eight-number summary and one
            interactive histogram. It opens in the editor when it is created.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="new-notebook-root">Folder</Label>
            <Select value={chosenRoot} onValueChange={setRootPath}>
              <SelectTrigger id="new-notebook-root" className="text-xs">
                <SelectValue placeholder="Choose a folder" />
              </SelectTrigger>
              <SelectContent>
                {roots.map((root) => (
                  <SelectItem key={root.path} value={root.path} className="text-xs">
                    {root.repoLabel} <span className="text-muted-foreground">· {root.category} · runs in {root.groupLabel}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="new-notebook-title">Title</Label>
            <Input id="new-notebook-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What the notebook answers" maxLength={120} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="new-notebook-description">One-line description</Label>
            <Textarea id="new-notebook-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} maxLength={300} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="new-notebook-file">File name</Label>
            <div className="flex items-center gap-1">
              <Input
                id="new-notebook-file"
                value={effectiveFileName}
                onChange={(event) => {
                  setFileNameTouched(true);
                  setFileName(event.target.value);
                }}
                className="font-mono text-xs"
                aria-invalid={!nameValid && effectiveFileName.length > 0}
              />
              <span className="font-mono text-xs text-muted-foreground">.py</span>
            </div>
            {!nameValid && effectiveFileName.length > 0 && (
              <p className="text-[11px] text-[#D55E00]">Lower-case letters, digits and underscores, starting with a letter.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canCreate}
            onClick={() => onCreate({ rootPath: chosenRoot, fileName: effectiveFileName, title: title.trim(), description: description.trim() })}
            data-testid="create-notebook"
          >
            {pending ? "Creating…" : "Create and edit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
