export interface TableInfo {
  name: string;
  rowCount: number;
  type?: string;
  partitions?: number;
  columns?: ColumnInfo[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
}

export interface DatabaseStats {
  connected: boolean;
  tables: number;
  tableDetails: TableInfo[];
  error?: string;
}

export interface FileUploadItem {
  file: File;
  symbol: string;
  assetType: "futures" | "forex";
  status: "pending" | "uploading" | "completed" | "failed";
  progress: number;
}

export function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}
