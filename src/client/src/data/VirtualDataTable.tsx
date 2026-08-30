import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { RefreshCw } from "lucide-react";

interface VirtualDataTableProps {
  tableName: string;
  data: Record<string, unknown>[];
  isLoading: boolean;
  onClose?: () => void;
  description?: string;
}

export function VirtualDataTable({ tableName, data, isLoading, onClose, description }: VirtualDataTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = Array.isArray(data) ? data : [];
  const columns = rows.length > 0 && rows[0] ? Object.keys(rows[0]) : [];

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 35, // 35px height per row
    overscan: 10,
  });

  return (
    <Card className="glass h-full flex flex-col overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="font-mono text-lg">{tableName}</CardTitle>
          <CardDescription>{description || `Preview (${rows.length} rows)`}</CardDescription>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex-1 p-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground font-mono text-sm">
            No data available
          </div>
        ) : (
          <div 
            ref={parentRef} 
            className="h-full overflow-auto w-full custom-scrollbar"
            style={{ maxHeight: '600px' }}
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              <table className="w-full text-sm text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-black/60 backdrop-blur-md text-muted-foreground font-mono text-xs uppercase shadow-sm">
                  <tr>
                    {columns.map((col) => (
                      <th key={col} className="px-4 py-2 border-b border-white/10 whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const rowData = rows[virtualRow.index];
                    if (!rowData) return null;
                    return (
                      <tr
                        key={virtualRow.index}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                        className="border-b border-white/5 hover:bg-white/5 transition-colors font-mono"
                      >
                        {columns.map((col) => {
                          const cellValue = rowData[col];
                          const displayValue = typeof cellValue === 'object' && cellValue !== null
                            ? JSON.stringify(cellValue)
                            : String(cellValue ?? '');
                          
                          return (
                            <td key={col} className="px-4 py-1.5 whitespace-nowrap truncate max-w-[200px]" title={displayValue}>
                              {displayValue}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
