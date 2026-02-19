import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Star, List } from "lucide-react";
import { useState, useMemo } from "react";

interface Instrument {
  id: number;
  symbol: string;
  name: string;
  assetType: string;
  exchange: string | null;
  tickSize: number;
  tickValue: number;
  pointValue: number;
  contractSize: number;
  currency: string;
  marginRequirement: number;
  tradingHours: string;
  decimalPlaces: number;
}

export default function Watchlist() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [favorites, setFavorites] = useState<number[]>([]);

  const { data: instruments = [], isLoading } = useQuery<Instrument[]>({
    queryKey: ["/api/instruments"],
  });

  const filteredInstruments = useMemo(() => {
    return instruments.filter(inst => {
      const matchesSearch = inst.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           inst.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = selectedType === "all" || inst.assetType === selectedType;
      return matchesSearch && matchesType;
    });
  }, [instruments, searchTerm, selectedType]);

  const groupedInstruments = useMemo(() => {
    const favoriteInsts = filteredInstruments.filter(i => favorites.includes(i.id));
    const otherInsts = filteredInstruments.filter(i => !favorites.includes(i.id));
    return { favorites: favoriteInsts, others: otherInsts };
  }, [filteredInstruments, favorites]);

  const toggleFavorite = (id: number) => {
    setFavorites(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  };

  const futuresCount = instruments.filter(i => i.assetType === 'futures').length;
  const forexCount = instruments.filter(i => i.assetType === 'forex').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 border border-primary/20">
            <List className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Watchlist</h1>
            <p className="text-xs text-muted-foreground">{instruments.length} instruments available</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-search-symbols"
            placeholder="Search symbols..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 bg-card border-border h-8 text-sm"
          />
        </div>
        <div className="flex gap-1">
          {[
            { key: "all", label: `All (${instruments.length})` },
            { key: "futures", label: `Futures (${futuresCount})` },
            { key: "forex", label: `Forex (${forexCount})` },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSelectedType(key)}
              className={`px-3 py-1.5 text-xs transition-all ${
                selectedType === key
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "bg-muted/50 text-muted-foreground border border-border hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading instruments...</div>
      ) : (
        <div className="space-y-4">
          {groupedInstruments.favorites.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                  Favorites ({groupedInstruments.favorites.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {groupedInstruments.favorites.map(inst => (
                    <InstrumentRow key={inst.id} instrument={inst} isFavorite onToggleFavorite={toggleFavorite} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="bg-card border-border">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {selectedType === "all" ? "All Instruments" : selectedType === "futures" ? "Futures" : "Forex"} ({groupedInstruments.others.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {groupedInstruments.others.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">No instruments found</div>
              ) : (
                <div className="divide-y divide-border">
                  {groupedInstruments.others.map(inst => (
                    <InstrumentRow key={inst.id} instrument={inst} isFavorite={false} onToggleFavorite={toggleFavorite} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function InstrumentRow({ instrument, isFavorite, onToggleFavorite }: { 
  instrument: Instrument; 
  isFavorite: boolean;
  onToggleFavorite: (id: number) => void;
}) {
  return (
    <div data-testid={`instrument-row-${instrument.id}`} className="flex items-center justify-between px-3 py-2.5 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-3">
        <button
          data-testid={`button-favorite-${instrument.id}`}
          onClick={() => onToggleFavorite(instrument.id)}
          className="p-1 hover:bg-muted rounded transition-colors"
        >
          <Star className={`h-3.5 w-3.5 ${isFavorite ? "text-amber-500 fill-amber-500" : "text-muted-foreground"}`} />
        </button>
        <div>
          <div className="flex items-center gap-2">
            <span data-testid={`text-symbol-${instrument.id}`} className="font-mono font-medium text-sm text-foreground">{instrument.symbol}</span>
            <Badge className="text-[9px] px-1 py-0 bg-muted text-muted-foreground border-border">
              {instrument.assetType}
            </Badge>
          </div>
          <span className="text-[10px] text-muted-foreground">{instrument.name}</span>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="text-right">
          <div className="font-mono text-sm text-muted-foreground">--</div>
          <div className="text-[10px] text-muted-foreground">No live data</div>
        </div>
        <div className="text-right hidden md:block">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Margin</div>
          <div data-testid={`text-margin-${instrument.id}`} className="font-mono text-xs text-foreground">{instrument.marginRequirement != null ? `$${instrument.marginRequirement.toLocaleString()}` : '--'}</div>
        </div>
        <div className="text-right hidden lg:block">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Tick</div>
          <div className="font-mono text-xs text-foreground">{instrument.tickSize} / ${instrument.tickValue}</div>
        </div>
      </div>
    </div>
  );
}
