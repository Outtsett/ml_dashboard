/**
 * Upload route — HTTP layer only.
 *
 * Handles multer file reception, request validation, and response formatting.
 * All ingestion logic lives in lib/ingestion/uploadProcessor.ts.
 */

import { Router, Request, Response } from "express";
import { storage } from "../storage";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import { uploadRateLimiter } from "../lib/rateLimiter";
import { processOhlcvFile } from "../lib/ingestion/uploadProcessor";

export const UPLOAD_TEMP_DIR = path.join(process.cwd(), 'data', 'uploads-tmp');
fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_TEMP_DIR,
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
    }
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});

const router = Router();

// Upload and ingest OHLCV data from .zst compressed CSV (rate limited)
router.post("/upload/ohlcv", uploadRateLimiter, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Validate file type by extension
    const ALLOWED_EXTENSIONS = ['.csv', '.json', '.txt', '.tsv'];
    const ALLOWED_MIMETYPES = [
      'text/csv', 'text/plain', 'application/json',
      'text/tab-separated-values', 'application/octet-stream'
    ];
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: `File type ${ext} not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` });
    }
    if (req.file.mimetype && !ALLOWED_MIMETYPES.includes(req.file.mimetype)) {
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: `MIME type ${req.file.mimetype} not allowed` });
    }

    const { symbol } = req.body;
    if (!symbol) {
      return res.status(400).json({ error: "Symbol is required" });
    }

    const uploadRecord = await storage.createUpload({
      filename: req.file.originalname,
      symbol,
      status: "processing",
      recordCount: 0,
    });

    // Read from disk (multer diskStorage) then process - avoids holding 500MB in memory
    const filePath = req.file.path;
    fs.promises.readFile(filePath)
      .then(buffer => processOhlcvFile(buffer, symbol, uploadRecord.id, req.file!.originalname))
      .then(() => fs.promises.unlink(filePath).catch(() => {}))
      .catch(err => {
        console.error("Error processing file:", err);
        storage.updateUploadStatus(uploadRecord.id, "failed");
        fs.promises.unlink(filePath).catch(() => {});
      });

    res.json({
      message: "Upload started",
      uploadId: uploadRecord.id,
      status: "processing"
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Failed to process upload" });
  }
});

// Get upload history
router.get("/uploads", async (req: Request, res: Response) => {
  try {
    const uploads = await storage.getUploads();
    res.json(uploads);
  } catch (error) {
    console.error("Error fetching uploads:", error);
    res.status(500).json({ error: "Failed to fetch uploads" });
  }
});

export default router;
