# Migrations — Drizzle SQLite Migrations

Drizzle Kit migration files for the SQLite database schema.

## Files

| File | Purpose |
|---|---|
| `0000_fantastic_hawkeye.sql` | Initial migration: creates all 37 SQLite tables |
| `meta/0000_snapshot.json` | Schema snapshot for migration diffing |
| `meta/_journal.json` | Migration journal tracking applied migrations |

## Usage

```bash
# Push schema changes directly (development)
npx drizzle-kit push

# Generate a new migration
npx drizzle-kit generate

# Apply migrations
npx drizzle-kit migrate
```

The schema source of truth is `src/shared/schema.ts` (Drizzle ORM definitions). Configuration in `drizzle.config.ts` points to `data/ml_dashboard.db`.
