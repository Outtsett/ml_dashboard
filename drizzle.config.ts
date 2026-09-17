import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./src/shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    // Overridable so a verification run can target a throwaway file instead of
    // the working database. `scripts/db-push-verify.mjs --db <path>` sets it;
    // with nothing set this is exactly the previous hardcoded value, which is
    // what CI and `npm run db:push` use.
    url: process.env.DRIZZLE_SQLITE_PATH ?? "data/ml_dashboard.db",
  },
});
