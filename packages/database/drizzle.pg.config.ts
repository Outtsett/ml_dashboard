import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations_pg",
  schema: "packages/shared/src/pg_schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.PG_DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/quant",
  },
});
