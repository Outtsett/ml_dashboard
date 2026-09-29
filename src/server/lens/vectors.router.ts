/**
 * The Lens vector space — every bar of a training run as a point, with nearest
 * neighbours searched in the FULL feature space by DuckDB's HNSW index.
 *
 * What this answers that the feature heatmap cannot
 * ------------------------------------------------
 * The Vectorize panel's heatmap shows each feature's value over time: it reads
 * across a row. It cannot answer "which other bars look like THIS one", because
 * that is a question about distance between points, and a grid of coloured
 * cells has no notion of distance. This does: the scatter places every bar by
 * its two leading principal components, and selecting one runs a real
 * k-nearest-neighbour query over every dimension of the space.
 *
 * Two bases, because the block widths are not equal — measured
 * ------------------------------------------------------------
 * `pattern_multihot` is 13 of the 32 dimensions, so under per-dimension
 * standardisation it holds 41% of the variance budget by construction. Measured
 * on MNQ 1h it takes **60.9% of PC1**, whose four largest loadings are all
 * pattern bits — so an all-32 layout is largely a map of which candlestick
 * patterns fired, and those are themselves derived from candle shape that
 * `geometry` already carries. PC2 is healthy by comparison (volume 24%,
 * structure 25%, kinematics 16%, geometry 16%, pattern 19%).
 *
 * That is a real choice, so it is exposed as one rather than decided here:
 * `?basis=continuous` (19 dims, the default) or `?basis=full` (all 32). The
 * response reports each axis's variance share per block, so the panel can state
 * what is actually driving the picture instead of implying it.
 *
 * The projection and the search always describe the SAME space
 * ------------------------------------------------------------
 * Each basis gets its own table and its own HNSW index. Projecting on 19
 * dimensions while searching over 32 would put neighbours far apart on screen
 * and the panel would quietly contradict itself.
 *
 * Standardised before both, because it changes the answer
 * -------------------------------------------------------
 * Measured per-feature standard deviation runs 0.30 mean across `geometry`
 * against 1.30 mean and 2.95 max across `structure` — `bars_since_last_pivot`
 * is an unbounded bar count. An un-standardised L2 distance is therefore mostly
 * a measurement of `structure`, and the two spaces genuinely disagree: bar
 * 3900's nearest neighbour is 3624 raw and 3456 standardised.
 *
 * Dimension order is fixed, never inferred
 * ----------------------------------------
 * `BLOCK_ORDER` pins which slot each block occupies. Taking the order from a
 * GROUP BY would let DuckDB's grouping decide it, and a vector whose dimensions
 * permute between rebuilds is a different vector with the same name.
 */
import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { queryQuestDB } from "../infrastructure/database/questdb";
import { logInfo } from "../infrastructure/lib/log";

const router = Router();

const RUNS_ROOT = process.env.TRAINING_RUNS_ROOT
  ?? "E:/source/repos/ml_dashboard/Trading/quant/model/data/training_runs";
const RUN_NAME = /^[A-Za-z0-9_\-]+$/;

/** The slot each block occupies in the packed vector. */
const BLOCK_ORDER = ["geometry", "kinematics", "volume", "structure", "pattern_multihot"] as const;
type BlockName = (typeof BLOCK_ORDER)[number];

/**
 * `continuous` is the default because PC1 over all 32 dimensions is 60.9%
 * pattern bits, which buries the geometry/kinematics/volume manifold the panel
 * exists to show.
 */
const BASES: Record<string, readonly BlockName[]> = {
  continuous: ["geometry", "kinematics", "volume", "structure"],
  full: BLOCK_ORDER,
};
type BasisName = keyof typeof BASES;

interface AxisReport {
  varianceExplained: number;
  /** Share of this axis's squared loading held by each block. */
  blockShare: Record<string, number>;
  topLoadings: { field: string; loading: number }[];
}

interface VectorSpace {
  table: string;
  basis: BasisName;
  bars: number;
  dimensions: number;
  /** Flat dimension labels, `block.field`, in packed order. */
  fields: string[];
  blocks: { name: string; width: number; offset: number }[];
  points: ProjectedPoint[];
  axes: [AxisReport, AxisReport];
}

interface ProjectedPoint {
  barIndex: number;
  timestamp: string;
  x: number;
  y: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** How many single-candle patterns fired on this bar. */
  patternCount: number;
}

/** One built space per (run, basis), for the life of the process. */
const spaces = new Map<string, Promise<VectorSpace>>();

function runDirectory(run: string): string | null {
  if (!RUN_NAME.test(run)) return null;
  const directory = path.join(RUNS_ROOT, run);
  if (!fs.existsSync(path.join(directory, "blocks.parquet"))) return null;
  if (!fs.existsSync(path.join(directory, "bars.parquet"))) return null;
  return directory;
}

const asPath = (p: string) => p.replace(/\\/g, "/").replace(/'/g, "''");

/** DuckDB hands back BIGINT as bigint, or as a decimal string when it is wide. */
const toNumber = (value: unknown): number =>
  typeof value === "number" ? value : Number(value);

/** The field list the run recorded for each block, read from its own stream. */
function blockFields(directory: string): Record<string, string[]> {
  const raw = fs.readFileSync(path.join(directory, "stream.jsonl"), "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as { type: string; fields?: Record<string, string[]> };
      if (event.type === "blocks" && event.fields) return event.fields;
    } catch {
      break;
    }
  }
  return {};
}

// ── Principal components ─────────────────────────────────────────────────────

/**
 * The eigenvectors of a symmetric matrix, by cyclic Jacobi rotation.
 *
 * Jacobi rather than a power iteration or a library: the matrix is at most
 * 32x32, so the whole decomposition costs less than the query that produced the
 * data, and it is deterministic to the last bit — the same run projects
 * identically on every reload, which a randomly-seeded iterative method would
 * not. Symmetric input is guaranteed; it is a covariance matrix.
 */
function jacobiEigen(input: number[][], sweeps = 80): { values: number[]; vectors: number[][] } {
  const n = input.length;
  const a = input.map(row => row.slice());
  // v accumulates the rotations; its COLUMNS end up the eigenvectors.
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) off += a[p]![q]! * a[p]![q]!;
    }
    if (off < 1e-18) break;

    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-15) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]!), vectors: v };
}

/**
 * Two principal-component coordinates per row, the share of total variance each
 * carries, and each axis's loadings.
 *
 * The sign of an eigenvector is arbitrary, so it is pinned: the component is
 * flipped to make its largest-magnitude loading positive. Without that the same
 * data can render mirrored between two runs of identical code, which reads as
 * the space having changed when nothing did.
 */
function projectToPlane(vectors: number[][]): {
  xy: [number, number][];
  axes: { varianceExplained: number; loadings: number[] }[];
} {
  const n = vectors.length;
  const d = vectors[0]!.length;
  const mean = new Array<number>(d).fill(0);
  for (const row of vectors) for (let j = 0; j < d; j += 1) mean[j]! += row[j]! / n;

  const covariance: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (const row of vectors) {
    for (let i = 0; i < d; i += 1) {
      const di = row[i]! - mean[i]!;
      for (let j = i; j < d; j += 1) {
        covariance[i]![j]! += (di * (row[j]! - mean[j]!)) / (n - 1);
      }
    }
  }
  for (let i = 0; i < d; i += 1) for (let j = i + 1; j < d; j += 1) covariance[j]![i] = covariance[i]![j]!;

  const { values, vectors: eigenvectors } = jacobiEigen(covariance);
  const order = values.map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value);
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0) || 1;

  const axes = [0, 1].map(which => {
    const column = order[which]!.index;
    let loadings = eigenvectors.map(row => row[column]!);
    let peak = 0;
    for (const component of loadings) if (Math.abs(component) > Math.abs(peak)) peak = component;
    if (peak < 0) loadings = loadings.map(component => -component);
    return { varianceExplained: Math.max(order[which]!.value, 0) / total, loadings };
  });

  const xy = vectors.map(row => {
    let x = 0;
    let y = 0;
    for (let j = 0; j < d; j += 1) {
      const centred = row[j]! - mean[j]!;
      x += centred * axes[0]!.loadings[j]!;
      y += centred * axes[1]!.loadings[j]!;
    }
    return [x, y] as [number, number];
  });

  return { xy, axes };
}

/** Squared-loading share per block, plus the biggest individual loadings. */
function describeAxis(
  axis: { varianceExplained: number; loadings: number[] },
  blocks: { name: string; width: number; offset: number }[],
  fields: string[],
): AxisReport {
  const blockShare: Record<string, number> = {};
  const totalSquared = axis.loadings.reduce((sum, value) => sum + value * value, 0) || 1;
  for (const block of blocks) {
    let squared = 0;
    for (let i = 0; i < block.width; i += 1) {
      const loading = axis.loadings[block.offset + i]!;
      squared += loading * loading;
    }
    blockShare[block.name] = squared / totalSquared;
  }
  const topLoadings = axis.loadings
    .map((loading, index) => ({ field: fields[index]!, loading }))
    .sort((a, b) => Math.abs(b.loading) - Math.abs(a.loading))
    .slice(0, 6);
  return { varianceExplained: axis.varianceExplained, blockShare, topLoadings };
}

// ── Building the space ───────────────────────────────────────────────────────

async function buildSpace(run: string, basis: BasisName, directory: string): Promise<VectorSpace> {
  const started = Date.now();
  const blocksFile = asPath(path.join(directory, "blocks.parquet"));
  const barsFile = asPath(path.join(directory, "bars.parquet"));
  const table = `lens_vectors_${run}_${basis}`;
  const included = BASES[basis]!;

  const measured = await queryQuestDB<{ array_name: string; bars: unknown; width: unknown }>(
    `SELECT array_name, MAX(row_index) + 1 AS bars, MAX(column_index) + 1 AS width
     FROM read_parquet('${blocksFile}') GROUP BY array_name`,
  );
  const widths = new Map(measured.map(r => [r.array_name, toNumber(r.width)]));
  // Widths are asserted against the file rather than hardcoded: a run trained
  // after a feature change would otherwise pack a wider vector into a narrower
  // ARRAY and fail with a cast error far from the cause.
  const missing = included.filter(name => !widths.has(name));
  if (missing.length > 0) throw new Error(`run is missing block(s): ${missing.join(", ")}`);

  const blocks = included.reduce<{ name: string; width: number; offset: number }[]>(
    (accumulated, name) => {
      const previous = accumulated[accumulated.length - 1];
      const offset = previous ? previous.offset + previous.width : 0;
      accumulated.push({ name, width: widths.get(name)!, offset });
      return accumulated;
    }, []);
  const dimensions = blocks.reduce((sum, block) => sum + block.width, 0);
  const bars = toNumber(measured[0]!.bars);

  const fieldsByBlock = blockFields(directory);
  const fields = blocks.flatMap(block => {
    const named = fieldsByBlock[block.name] ?? [];
    return Array.from({ length: block.width }, (_, i) =>
      `${block.name}.${named[i] ?? `dimension_${i}`}`);
  });

  const rank = included.map((name, index) => `WHEN '${name}' THEN ${index}`).join(" ");
  const inList = included.map(name => `'${name}'`).join(", ");

  // The standardisation statistics come from the run's own bars — the only
  // population these coordinates are ever compared within. They are never
  // compared across runs.
  //
  // A dimension that never moves (kinematics carries one at sd 5e-4 on MNQ 1h)
  // divides by 1 rather than by ~0, which would turn float noise into a
  // dominant axis.
  await queryQuestDB(`DROP TABLE IF EXISTS ${table}`);
  await queryQuestDB(`
    CREATE TABLE ${table} AS
    WITH cells AS (
      SELECT row_index AS bar_index,
             CASE array_name ${rank} END AS block_rank,
             column_index, value
      FROM read_parquet('${blocksFile}')
      WHERE array_name IN (${inList})
    ),
    moments AS (
      SELECT block_rank, column_index, avg(value) AS mu,
             CASE WHEN stddev_samp(value) < 1e-9 THEN 1.0 ELSE stddev_samp(value) END AS sd
      FROM cells GROUP BY block_rank, column_index
    ),
    packed AS (
      SELECT c.bar_index,
             CAST(list((c.value - m.mu) / m.sd ORDER BY c.block_rank, c.column_index)
                  AS FLOAT[${dimensions}]) AS vector
      FROM cells c JOIN moments m USING (block_rank, column_index)
      GROUP BY c.bar_index
    ),
    patterns AS (
      SELECT row_index AS bar_index,
             CAST(SUM(CASE WHEN value <> 0 THEN 1 ELSE 0 END) AS INTEGER) AS pattern_count
      FROM read_parquet('${blocksFile}')
      WHERE array_name = 'pattern_multihot' GROUP BY row_index
    ),
    ohlcv AS (
      SELECT row_number() OVER () - 1 AS bar_index, timestamp, open, high, low, close, volume
      FROM read_parquet('${barsFile}')
    )
    SELECT p.bar_index, o.timestamp, o.open, o.high, o.low, o.close, o.volume,
           COALESCE(t.pattern_count, 0) AS pattern_count, p.vector
    FROM packed p
    JOIN ohlcv o USING (bar_index)
    LEFT JOIN patterns t USING (bar_index)
  `);

  // l2sq, not cosine: volume z-score magnitude and leg-deviation magnitude are
  // meaningful here, and cosine would discard exactly that by normalising every
  // bar onto the unit sphere.
  await queryQuestDB(
    `CREATE INDEX ${table}_hnsw ON ${table} USING HNSW (vector) WITH (metric = 'l2sq')`);

  const rows = await queryQuestDB<Record<string, unknown>>(
    `SELECT bar_index, timestamp::VARCHAR AS timestamp, open, high, low, close, volume,
            pattern_count, array_to_string(vector::FLOAT[], ',') AS packed
     FROM ${table} ORDER BY bar_index`,
  );

  const packed = rows.map(row => String(row.packed).split(",").map(Number));
  const { xy, axes } = projectToPlane(packed);

  const points: ProjectedPoint[] = rows.map((row, index) => ({
    barIndex: toNumber(row.bar_index),
    timestamp: String(row.timestamp),
    x: xy[index]![0],
    y: xy[index]![1],
    open: toNumber(row.open),
    high: toNumber(row.high),
    low: toNumber(row.low),
    close: toNumber(row.close),
    volume: toNumber(row.volume),
    patternCount: toNumber(row.pattern_count),
  }));

  const described = axes.map(axis => describeAxis(axis, blocks, fields)) as [AxisReport, AxisReport];

  logInfo(`[lens] vector space ${run}/${basis}: ${bars} bars x ${dimensions} dims, `
    + `PC1 ${(described[0].varianceExplained * 100).toFixed(1)}% `
    + `PC2 ${(described[1].varianceExplained * 100).toFixed(1)}%, ${Date.now() - started}ms`);

  return { table, basis, bars, dimensions, fields, blocks, points, axes: described };
}

function spaceFor(run: string, basis: BasisName, directory: string): Promise<VectorSpace> {
  const key = `${run}:${basis}`;
  const existing = spaces.get(key);
  if (existing) return existing;
  // A failed build is not cached — the next request rebuilds rather than
  // serving the same error until the process restarts.
  const building = buildSpace(run, basis, directory).catch(error => {
    spaces.delete(key);
    throw error;
  });
  spaces.set(key, building);
  return building;
}

function requestedBasis(req: Request): BasisName | null {
  const raw = req.query.basis === undefined ? "continuous" : String(req.query.basis);
  return raw in BASES ? raw : null;
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/lens/training/runs/:run/vectors?basis=continuous|full */
router.get("/lens/training/runs/:run/vectors", async (req: Request, res: Response) => {
  const run = String(req.params.run);
  const directory = runDirectory(run);
  if (!directory) {
    res.status(404).json({ error: "no such run, or it wrote no blocks/bars snapshot" });
    return;
  }
  const basis = requestedBasis(req);
  if (!basis) {
    res.status(400).json({ error: `basis must be one of: ${Object.keys(BASES).join(", ")}` });
    return;
  }
  try {
    const space = await spaceFor(run, basis, directory);
    res.json({
      run,
      basis,
      bases: Object.keys(BASES),
      bars: space.bars,
      dimensions: space.dimensions,
      fields: space.fields,
      blocks: space.blocks,
      axes: space.axes,
      points: space.points,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * GET /api/lens/training/runs/:run/vectors/:bar/neighbours?k=12&basis=...
 *
 * The query vector is inlined as a literal rather than read back with a
 * correlated subquery. Measured: the subquery form plans a full scan while the
 * literal form plans `HNSW_INDEX_SCAN` — the index is only consulted when the
 * probe is a constant expression.
 */
router.get("/lens/training/runs/:run/vectors/:bar/neighbours",
  async (req: Request, res: Response) => {
    const run = String(req.params.run);
    const directory = runDirectory(run);
    if (!directory) {
      res.status(404).json({ error: "no such run" });
      return;
    }
    const basis = requestedBasis(req);
    if (!basis) {
      res.status(400).json({ error: `basis must be one of: ${Object.keys(BASES).join(", ")}` });
      return;
    }
    const bar = Number(req.params.bar);
    if (!Number.isInteger(bar) || bar < 0) {
      res.status(400).json({ error: "bar must be a non-negative integer" });
      return;
    }
    const k = Math.min(Math.max(Number(req.query.k) || 12, 1), 200);

    try {
      const space = await spaceFor(run, basis, directory);
      const probe = await queryQuestDB<{ packed: string }>(
        `SELECT array_to_string(vector::FLOAT[], ',') AS packed
         FROM ${space.table} WHERE bar_index = ${bar}`,
      );
      if (probe.length === 0) {
        res.status(404).json({ error: `bar ${bar} is not in this run's window` });
        return;
      }
      const literal = `CAST([${probe[0]!.packed}] AS FLOAT[${space.dimensions}])`;

      // LIMIT k + 1, then drop the query bar here.
      //
      // Measured: `WHERE bar_index <> :bar ... LIMIT k` returns k - 1 rows. The
      // HNSW scan takes its LIMIT first and the filter runs afterwards, so the
      // self-match at distance 0 consumes one of the k slots and a request for
      // 12 neighbours silently yields 11. Filtering outside the index keeps the
      // count honest without pushing the query off the index.
      const found = await queryQuestDB<Record<string, unknown>>(
        `SELECT bar_index, timestamp::VARCHAR AS timestamp, open, high, low, close, volume,
                pattern_count, array_distance(vector, ${literal}) AS distance
         FROM ${space.table}
         ORDER BY distance
         LIMIT ${k + 1}`,
      );
      const neighbours = found.filter(row => toNumber(row.bar_index) !== bar).slice(0, k);

      res.json({
        run,
        basis,
        bar,
        k,
        dimensions: space.dimensions,
        neighbours: neighbours.map(row => ({
          barIndex: toNumber(row.bar_index),
          timestamp: String(row.timestamp),
          distance: toNumber(row.distance),
          open: toNumber(row.open),
          high: toNumber(row.high),
          low: toNumber(row.low),
          close: toNumber(row.close),
          volume: toNumber(row.volume),
          patternCount: toNumber(row.pattern_count),
        })),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

export default router;
