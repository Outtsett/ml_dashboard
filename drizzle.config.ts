import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./src/shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: "data/ml_dashboard.db",
  },
});
