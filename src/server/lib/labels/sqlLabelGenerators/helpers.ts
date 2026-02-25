/**
 * Shared types and SQL helper fragments for label generators
 */

export interface LabelGeneratorConfig {
  symbol: string;
  tableName?: string;
  timestampColumn?: string;
  symbolColumn?: string;
}

export const DEFAULT_CONFIG: Partial<LabelGeneratorConfig> = {
  tableName: 'ohlcv',
  timestampColumn: 'timestamp',
  symbolColumn: 'symbol',
};

export function partitionClause(config: LabelGeneratorConfig): string {
  return `PARTITION BY ${config.symbolColumn || 'symbol'}`;
}

export function orderClause(config: LabelGeneratorConfig): string {
  return `ORDER BY ${config.timestampColumn || 'timestamp'}`;
}

export function windowOver(config: LabelGeneratorConfig): string {
  return `OVER (${partitionClause(config)} ${orderClause(config)})`;
}

export function rowsBetween(before: number, after: number, config: LabelGeneratorConfig): string {
  const beforeClause = before === 0 ? 'CURRENT ROW' : `${before} PRECEDING`;
  const afterClause = after === 0 ? 'CURRENT ROW' : `${after} FOLLOWING`;
  return `OVER (${partitionClause(config)} ${orderClause(config)} ROWS BETWEEN ${beforeClause} AND ${afterClause})`;
}
