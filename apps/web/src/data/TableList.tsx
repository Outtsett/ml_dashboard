import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible";
import { ChevronDown, ChevronRight, Table2, Layers, Eye } from "lucide-react";
import type { TableInfo } from "@/shared/utils/types";
import { formatNumber } from "@/shared/utils/types";

interface TableListProps {
  tables: TableInfo[];
  dbType: string;
  expandedTables: Set<string>;
  onToggleTable: (name: string) => void;
  onPreview: (tableName: string, dbType: string) => void;
}

export function TableList({ tables, dbType, expandedTables, onToggleTable, onPreview }: TableListProps) {
  return (
    <div className="space-y-2">
      {tables.map((table) => (
        <Collapsible key={table.name} open={expandedTables.has(table.name)}>
          <div className="glass rounded-lg overflow-hidden">
            <div className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors">
              <CollapsibleTrigger
                className="flex-1 flex items-center gap-3 text-left"
                onClick={() => onToggleTable(table.name)}
                data-testid={`table-${table.name}`}
              >
                {expandedTables.has(table.name) ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <Table2 className="h-4 w-4 text-primary" />
                <span className="font-mono text-sm">{table.name}</span>
                {table.type && (
                  <Badge variant="outline" className="text-xs">
                    {table.type}
                  </Badge>
                )}
              </CollapsibleTrigger>
              <div className="flex items-center gap-4 pl-4">
                {table.partitions && (
                  <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                    <Layers className="h-3 w-3" />
                    {table.partitions} partitions
                  </span>
                )}
                <span className="text-xs text-accent font-mono">
                  {formatNumber(table.rowCount)} rows
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() => onPreview(table.name, dbType)}
                  data-testid={`preview-${table.name}`}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  Preview
                </Button>
              </div>
            </div>
            <CollapsibleContent>
              <div className="px-4 pb-3 pt-1 border-t border-white/5">
                {table.columns && table.columns.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {table.columns.map((col) => (
                      <div key={col.name} className="flex items-center gap-2 font-mono text-muted-foreground">
                        <span className="text-foreground">{col.name}</span>
                        <span className="text-primary/70">{col.type}</span>
                        {col.nullable === false && <Badge variant="outline" className="text-[10px] px-1">NOT NULL</Badge>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Click to load column info...</p>
                )}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ))}
    </div>
  );
}
