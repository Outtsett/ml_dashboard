import express, { type Express, type Request, type Response, type NextFunction } from "express";
import fs from "fs";
import path from "path";

/**
 * Serve pre-compressed static assets (brotli → gzip → original fallback).
 * vite-plugin-compression2 generates .br and .gz files at build time.
 * This middleware serves them with correct Content-Encoding headers,
 * eliminating runtime compression CPU overhead for hashed assets.
 */
function preCompressedAssets(distPath: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Only handle GET/HEAD for asset files (Vite hashed output)
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const relPath = req.path;
    if (!relPath.startsWith('/assets/')) return next();

    const acceptEncoding = req.headers['accept-encoding'] || '';
    const fullPath = path.join(distPath, relPath);

    // Try brotli first (smallest), then gzip
    if (acceptEncoding.includes('br')) {
      const brPath = fullPath + '.br';
      if (fs.existsSync(brPath)) {
        res.setHeader('Content-Encoding', 'br');
        res.setHeader('Vary', 'Accept-Encoding');
        // Infer content type from original extension
        const ext = path.extname(relPath);
        if (ext === '.js') res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        else if (ext === '.css') res.setHeader('Content-Type', 'text/css; charset=utf-8');
        else if (ext === '.json') res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.sendFile(brPath);
      }
    }

    if (acceptEncoding.includes('gzip')) {
      const gzPath = fullPath + '.gz';
      if (fs.existsSync(gzPath)) {
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        const ext = path.extname(relPath);
        if (ext === '.js') res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        else if (ext === '.css') res.setHeader('Content-Type', 'text/css; charset=utf-8');
        else if (ext === '.json') res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.sendFile(gzPath);
      }
    }

    next();
  };
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(process.cwd(), "dist", "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve pre-compressed .br/.gz assets before express.static
  app.use(preCompressedAssets(distPath));

  app.use(express.static(distPath, {
    maxAge: '1d',  // Vite hashes filenames — safe to cache long
  }));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
