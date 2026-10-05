import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import * as duckdb from '@duckdb/duckdb-wasm';

interface DuckDBContextValue {
  db: duckdb.AsyncDuckDB | null;
  loading: boolean;
  error: Error | null;
}

const DuckDBContext = createContext<DuckDBContextValue>({
  db: null,
  loading: true,
  error: null,
});

export const useDuckDB = () => useContext(DuckDBContext);

let globalDbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

async function initDuckDB(): Promise<duckdb.AsyncDuckDB> {
  // Select the appropriate bundles based on the browser's capabilities
  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

  // Instantiate the worker
  const worker_url = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker!}");`], { type: 'text/javascript' })
  );

  const worker = new Worker(worker_url);
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);

  // Initialize the database
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(worker_url);

  return db;
}

export const DuckDBProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [db, setDb] = useState<duckdb.AsyncDuckDB | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!globalDbPromise) {
      globalDbPromise = initDuckDB();
    }
    
    globalDbPromise
      .then((instance) => {
        setDb(instance);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to initialize DuckDB-WASM:", err);
        setError(err);
        setLoading(false);
      });
  }, []);

  return (
    <DuckDBContext.Provider value={{ db, loading, error }}>
      {children}
    </DuckDBContext.Provider>
  );
};
