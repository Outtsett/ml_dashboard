import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "../packages/shared/src/schema";

import { Pool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import * as pgSchema from "../packages/shared/src/pg_schema";

const sqliteDbPath = "./data/ml_dashboard.db";
const pgConnectionString = "postgresql://postgres:postgres@127.0.0.1:5433/quant";

async function main() {
  console.log("Connecting to SQLite...");
  const sqlite = new Database(sqliteDbPath);
  const dbSqlite = drizzleSqlite(sqlite, { schema: sqliteSchema });

  console.log("Connecting to Postgres...");
  const pool = new Pool({ connectionString: pgConnectionString });
  const dbPg = drizzlePg(pool, { schema: pgSchema });

  const tableNames = [
    'agentRuns', 'backtestRuns', 'backtestTrades', 'brokerConfigs', 'coherenceSnapshots',
    'contrastivePairs', 'curriculumBookmarks', 'curriculumProgress', 'curriculumSectionProgress',
    'datasetCategories', 'datasetVersions', 'datasets', 'deployments', 'ensembleConfigs',
    'entityAnnotations', 'entityRelationships', 'evaluationResults', 'events', 'experiments',
    'featureCategories', 'featureDependencies', 'featureImportance', 'featureParameters',
    'featureRequires', 'featureSets', 'featureTransforms', 'featureTypes', 'features',
    'generatedLabels', 'hpoSearchSpaces', 'hpoSessions', 'hpoTrials', 'ingestedFiles',
    'instruments', 'lossHistory', 'marketRegimes', 'mlModels', 'mlStudioPipelineStates',
    'modelCheckpoints', 'modelDriftMetrics', 'modelOutputs', 'modelStateSnapshots',
    'modelVersions', 'models', 'newsArticles', 'newsSymbols', 'predictionLog',
    'promotionGates', 'regimeHistory', 'runManifests', 'runMetrics', 'runMetricsFinal',
    'runs', 'strategies', 'studies', 'systemComponents', 'trades', 'trainingMetrics',
    'trainingRuns', 'trainingSessions', 'uploads', 'userPreferences', 'users', 'wfvDefinitions'
  ];

  console.log("Migrating tables:", tableNames.length);

  await pool.query("SET session_replication_role = replica;");

  for (const tableName of tableNames) {
    const sqliteTable = (sqliteSchema as any)[tableName];
    const pgTable = (pgSchema as any)[tableName];
    
    if (!pgTable) {
      console.log(`Skipping ${tableName} - not found in pgSchema`);
      continue;
    }
    
    try {
      const rows = dbSqlite.select().from(sqliteTable).all();
      console.log(`Migrating ${tableName}... (${rows.length} rows)`);
      
      if (rows.length > 0) {
        const chunkSize = 500;
        for (let i = 0; i < rows.length; i += chunkSize) {
          const chunk = rows.slice(i, i + chunkSize);
          
          for (const row of chunk) {
            for (const key of Object.keys(row)) {
              const pgCol = (pgTable as any)[key];
              if (pgCol && pgCol.dataType === 'boolean' && typeof row[key] === 'number') {
                row[key] = row[key] === 1;
              }
              if (pgCol && (pgCol.dataType === 'json' || pgCol.dataType === 'jsonb') && typeof row[key] === 'string') {
                try {
                  row[key] = JSON.parse(row[key]);
                } catch (e) {}
              }
            }
          }
          
          try {
            await dbPg.insert(pgTable).values(chunk).onConflictDoNothing();
          } catch (err: any) {
            console.error(`Error inserting chunk into ${tableName}:`, err.message);
          }
        }
      }
    } catch (e: any) {
      console.log(`Failed to migrate ${tableName}:`, e.message);
    }
  }

  await pool.query("SET session_replication_role = DEFAULT;");
  
  console.log("Migration complete.");
  process.exit(0);
}

main().catch(console.error);
