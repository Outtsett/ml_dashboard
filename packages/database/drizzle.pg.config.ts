import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations_pg",
  schema: "../shared/src/pg_schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.PG_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/ml_dashboard",
  },
});
