declare module 'parquetjs' {
  export class ParquetReader {
    static openFile(filePath: string): Promise<ParquetReader>;
    getCursor(): ParquetCursor;
    close(): Promise<void>;
  }

  export interface ParquetCursor {
    next(): Promise<Record<string, any> | null>;
  }
}
