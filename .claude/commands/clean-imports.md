# Clean Imports

Scan and auto-fix stale imports across Python and TypeScript files.

## Steps

### 1. Python (Ruff)

Run ruff to remove unused imports and sort remaining:

```bash
ruff check --fix src/ml/ scripts/
```

Report what was fixed. If ruff finds issues it can't auto-fix, list them.

### 2. TypeScript (ESLint)

Run ESLint to remove unused TypeScript imports:

```bash
npx eslint --fix src/
```

Report what was fixed. If ESLint finds issues it can't auto-fix, list them.

### 3. Python `__init__.py` Audit

For each `__init__.py` under `src/ml/`:
1. Read the file and list all names in `__all__` (or all top-level imports)
2. For each exported name, grep the codebase for external imports of that name
3. If a name has zero consumers outside its own package, flag it as dead
4. Offer to remove dead exports

### 4. TypeScript Barrel File Audit

For files that are purely re-exports (barrel files — identified by having only `export { ... } from` or `export * from` statements):
1. Check each re-exported name still exists in the source module
2. Check each re-exported name has at least one consumer
3. Flag dead re-exports

### 5. Summary

Print a table showing:
- Files modified
- Imports removed (count)
- Dead exports found
- Any manual fixes needed
