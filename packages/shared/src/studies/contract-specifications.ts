/**
 * Stock-index futures: tick, exchange, contract size, months, rolls and hours.
 * The body of GET /api/studies/contract-specifications, and the pure compute
 * the page and the tests share. Replaced notebooks/contract_specifications.py.
 *
 * The specification numbers are the dashboard's own config
 * (packages/config/contract_specifications.json, read through packages/shared/src/instruments.ts,
 * the module the chart's tick label and the instruments seed already use), so
 * the page reads them from there and never from a second copy. The server
 * serves only what the lake holds: the daily front contract per root (rolls)
 * and the 1-minute bar count per stamped hour (the Globex halt).
 */

import specifications from "../../../config/contract_specifications.json";
import { CONTRACT_SPECIFICATIONS, MONTH_CODES } from "../instruments";

export { MONTH_CODES };

/** The eight roots the lake carries, in the order the notebook lists them. */
export const LAKE_ROOTS = ["ES", "M2K", "MES", "MNQ", "MYM", "NQ", "RTY", "YM"] as const;
export type LakeRoot = (typeof LAKE_ROOTS)[number];

export type HoursSeries = "allContracts" | "rootSeries";

/** One row of the notebook's `contract_specifications` frame (column names spelled out). */
export interface SpecificationRow {
  symbol: string;
  name: string;
  product_group: string;
  exchange: string;
  exchange_group: string;
  currency: string;
  contract_multiplier_per_index_point: number;
  tick_size_index_points: number;
  tick_value_per_contract: number;
  price_decimal_places: number;
  contract_months: string | null;
  contract_months_note: string;
  in_lake: boolean;
  verification: string;
  trading_hours_central_time: string | null;
  last_trading_day: string | null;
}

export interface SpecificationSource {
  retrievedOn: string;
  sourceUrl: string;
  sectionsRead: string[];
  contractCount: number;
  cmeRollRule: string;
  cmeRollSourceUrl: string;
}

export const SPECIFICATION_SOURCE: SpecificationSource = {
  retrievedOn: specifications.retrieved_on,
  sourceUrl: specifications.source_url,
  sectionsRead: specifications.sections_read,
  contractCount: specifications.contract_count,
  cmeRollRule: specifications.cme_equity_index_roll_date.rule,
  cmeRollSourceUrl: specifications.cme_equity_index_roll_date.source_url,
};

export function specificationRows(): SpecificationRow[] {
  return CONTRACT_SPECIFICATIONS.map((contract) => ({
    symbol: contract.symbol,
    name: contract.name,
    product_group: contract.product_group,
    exchange: contract.exchange,
    exchange_group: contract.exchange_group,
    currency: contract.currency,
    contract_multiplier_per_index_point: contract.contract_multiplier_per_index_point,
    tick_size_index_points: contract.tick_size_index_points,
    tick_value_per_contract: contract.tick_value_per_contract,
    price_decimal_places: contract.price_decimal_places,
    contract_months: contract.contract_months ? contract.contract_months.join(",") : null,
    contract_months_note: contract.contract_months_note,
    in_lake: contract.in_lake,
    verification: contract.verification.join(" + "),
    trading_hours_central_time: contract.trading_hours_central_time ?? null,
    last_trading_day: contract.last_trading_day ?? null,
  }));
}

/** Rows whose exchange group and currency are not hidden (and, optionally, only the lake's roots). */
export function filterSpecifications(
  rows: readonly SpecificationRow[],
  hiddenExchangeGroups: readonly string[],
  hiddenCurrencies: readonly string[],
  lakeOnly: boolean,
): SpecificationRow[] {
  return rows.filter(
    (row) =>
      !hiddenExchangeGroups.includes(row.exchange_group) &&
      !hiddenCurrencies.includes(row.currency) &&
      (!lakeOnly || row.in_lake),
  );
}

/** The notebook's "verification" table: contracts and lake roots per verification source. */
export function verificationSummary(rows: readonly SpecificationRow[]): Array<{ verification: string; contracts: number; in_lake: number }> {
  const byVerification = new Map<string, { contracts: number; in_lake: number }>();
  for (const row of rows) {
    const entry = byVerification.get(row.verification) ?? { contracts: 0, in_lake: 0 };
    entry.contracts += 1;
    if (row.in_lake) entry.in_lake += 1;
    byVerification.set(row.verification, entry);
  }
  return [...byVerification.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([verification, counts]) => ({ verification, ...counts }));
}

// ---------------------------------------------------------------------------
// The formula, operated:  tick value = tick size x multiplier;
// profit = (delta p / tick size) x tick value x n = sum over ticks i = 1..k of (tick value x n)
// ---------------------------------------------------------------------------

export interface StaircasePoint {
  tick_index: number;
  running_total: number;
  index_price_move_points: number;
}

/** Whole ticks the index moved: the price can only land where the exchange lets it trade. */
export function ticksMoved(indexPointsMoved: number, tickSizeIndexPoints: number): number {
  return Math.round(indexPointsMoved / tickSizeIndexPoints);
}

export function profitInCurrency(ticks: number, tickValuePerContract: number, contractsHeld: number): number {
  return ticks * tickValuePerContract * contractsHeld;
}

/** Each tick adds one tick value (times n) to the running total, from tick 0 to tick k (k may be negative). */
export function staircase(ticks: number, tickSizeIndexPoints: number, tickValuePerContract: number, contractsHeld: number): StaircasePoint[] {
  const direction = ticks >= 0 ? 1 : -1;
  const points: StaircasePoint[] = [];
  for (let step = 0; step !== ticks + direction; step += direction) {
    points.push({
      tick_index: step,
      running_total: step * tickValuePerContract * contractsHeld,
      index_price_move_points: step * tickSizeIndexPoints,
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Months: the quarterly cycle and CME's roll date
// ---------------------------------------------------------------------------

export const QUARTERLY_MONTHS: ReadonlyArray<readonly [code: string, month: number]> = [
  ["H", 3],
  ["M", 6],
  ["U", 9],
  ["Z", 12],
];

function isoDate(epochDay: number): string {
  return new Date(epochDay * 86_400_000).toISOString().slice(0, 10);
}

function epochDayOf(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
}

/** The third Friday of a month, as YYYY-MM-DD (the day a quarterly equity-index future stops trading). */
export function thirdFriday(year: number, month: number): string {
  const firstOfMonthWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // Sunday = 0
  const firstFriday = 1 + ((5 - firstOfMonthWeekday + 7) % 7);
  return isoDate(Math.round(Date.UTC(year, month - 1, firstFriday + 14) / 86_400_000));
}

/** CME's published equity-index roll date: the Monday before the third Friday (4 days earlier). */
export function cmeRollDate(thirdFridayIso: string): string {
  return isoDate(epochDayOf(thirdFridayIso) - 4);
}

export function daysBetween(laterIso: string, earlierIso: string): number {
  return epochDayOf(laterIso) - epochDayOf(earlierIso);
}

export interface ExpiryRow {
  month_code: string;
  month_name: string;
  third_friday_expiry: string;
  cme_roll_date: string;
}

export function quarterlyExpiries(year: number): ExpiryRow[] {
  return QUARTERLY_MONTHS.map(([code, month]) => {
    const expiry = thirdFriday(year, month);
    return { month_code: code, month_name: MONTH_CODES[code] ?? code, third_friday_expiry: expiry, cme_roll_date: cmeRollDate(expiry) };
  });
}

export interface ObservedRoll {
  roll_day: string;
  previous_contract: string;
  front_contract: string;
  front_contract_volume: number;
}

export interface RollComparisonRow extends ExpiryRow {
  lake_observed_roll_day: string | null;
  days_before_expiry: number | null;
  from_contract: string | null;
  to_contract: string | null;
}

/** For each quarterly expiry, the lake's first volume roll from 21 days before to 3 days after it (the notebook's window). */
export function compareRolls(expiries: readonly ExpiryRow[], rolls: readonly ObservedRoll[]): RollComparisonRow[] {
  const sorted = [...rolls].sort((a, b) => (a.roll_day < b.roll_day ? -1 : a.roll_day > b.roll_day ? 1 : 0));
  return expiries.map((expiry) => {
    const expiryDay = epochDayOf(expiry.third_friday_expiry);
    const match = sorted.find((roll) => {
      const day = epochDayOf(roll.roll_day);
      return day >= expiryDay - 21 && day <= expiryDay + 3;
    });
    return {
      ...expiry,
      lake_observed_roll_day: match?.roll_day ?? null,
      days_before_expiry: match ? expiryDay - epochDayOf(match.roll_day) : null,
      from_contract: match?.previous_contract ?? null,
      to_contract: match?.front_contract ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Hours: CME Globex, Central time = stamped Pacific wall clock + 2 hours
// ---------------------------------------------------------------------------

export function centralHourOf(stampedHourPacific: number): number {
  return (stampedHourPacific + 2) % 24;
}

export interface HourRow {
  stamped_hour_pacific: number;
  one_minute_bar_count: number;
  hour_central_time: number;
  no_bars: boolean;
}

/** Fills all 24 stamped hours, zero where the lake has no bar. */
export function barsByHour(counts: ReadonlyArray<{ stamped_hour_pacific: number; one_minute_bar_count: number }>): HourRow[] {
  const byHour = new Map(counts.map((row) => [row.stamped_hour_pacific, row.one_minute_bar_count]));
  return Array.from({ length: 24 }, (_unused, hour) => {
    const count = byHour.get(hour) ?? 0;
    return { stamped_hour_pacific: hour, one_minute_bar_count: count, hour_central_time: centralHourOf(hour), no_bars: count === 0 };
  });
}

// ---------------------------------------------------------------------------
// The response body
// ---------------------------------------------------------------------------

export interface RootCoverage {
  root: string;
  first_day: string;
  last_day: string;
  day_count: number;
}

export interface FrontDay {
  day: string;
  front_contract: string;
}

export interface RollsBody {
  root: string;
  year: number;
  frontByDay: FrontDay[];
  observedRolls: ObservedRoll[];
  rollCountByYear: Array<{ year: number; roll_count: number }>;
}

export interface HoursBody {
  root: string;
  series: HoursSeries;
  counts: Array<{ stamped_hour_pacific: number; one_minute_bar_count: number }>;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  totalBars: number;
}

export interface ContractSpecificationsBody {
  coverage: RootCoverage[];
  rolls: RollsBody;
  hours: HoursBody;
}
