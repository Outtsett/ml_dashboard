import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Newspaper, Search, ExternalLink, Clock, TrendingUp, RefreshCw, Star, Sparkles, Zap, Radio } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback } from "react";

interface NewsItem {
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  symbol?: string;
  sentiment?: "positive" | "negative" | "neutral";
  isNew?: boolean;
}

const watchlistSymbols = [
  // CME Equity Index Futures
  { symbol: "ES", name: "E-mini S&P 500", type: "CME" },
  { symbol: "MES", name: "Micro E-mini S&P 500", type: "CME" },
  { symbol: "NQ", name: "E-mini Nasdaq 100", type: "CME" },
  { symbol: "MNQ", name: "Micro E-mini Nasdaq", type: "CME" },
  { symbol: "RTY", name: "E-mini Russell 2000", type: "CME" },
  { symbol: "M2K", name: "Micro E-mini Russell", type: "CME" },
  // CBOT Dow Futures
  { symbol: "YM", name: "E-mini Dow", type: "CBOT" },
  { symbol: "MYM", name: "Micro E-mini Dow", type: "CBOT" },
  // Top 15 Liquid Forex Pairs
  { symbol: "EURUSD", name: "Euro/US Dollar", type: "forex" },
  { symbol: "USDJPY", name: "US Dollar/Japanese Yen", type: "forex" },
  { symbol: "GBPUSD", name: "British Pound/US Dollar", type: "forex" },
  { symbol: "AUDUSD", name: "Australian Dollar/US Dollar", type: "forex" },
  { symbol: "USDCAD", name: "US Dollar/Canadian Dollar", type: "forex" },
  { symbol: "USDCHF", name: "US Dollar/Swiss Franc", type: "forex" },
  { symbol: "NZDUSD", name: "New Zealand Dollar/US Dollar", type: "forex" },
  { symbol: "EURJPY", name: "Euro/Japanese Yen", type: "forex" },
  { symbol: "GBPJPY", name: "British Pound/Japanese Yen", type: "forex" },
  { symbol: "EURGBP", name: "Euro/British Pound", type: "forex" },
  { symbol: "AUDJPY", name: "Australian Dollar/Japanese Yen", type: "forex" },
  { symbol: "EURAUD", name: "Euro/Australian Dollar", type: "forex" },
  { symbol: "EURCHF", name: "Euro/Swiss Franc", type: "forex" },
  { symbol: "AUDNZD", name: "Australian Dollar/New Zealand Dollar", type: "forex" },
  { symbol: "GBPAUD", name: "British Pound/Australian Dollar", type: "forex" },
];

export default function News() {
  const queryClient = useQueryClient();
  const [selectedSymbol, setSelectedSymbol] = useState<string>("MNQ");
  const [searchQuery, setSearchQuery] = useState("");
  const [isStreaming, setIsStreaming] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [newsData, setNewsData] = useState<NewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const eventSourceRef = useRef<EventSource | null>(null);
  const seenNewsRef = useRef<Set<string>>(new Set());
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const cleanupConnection = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const connectToStream = useCallback((symbol: string) => {
    cleanupConnection();
    
    seenNewsRef.current.clear();
    setConnectionStatus('connecting');
    setIsLoading(true);
    
    const eventSource = new EventSource(`/api/news/stream/${symbol}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setConnectionStatus('connected');
    };

    eventSource.addEventListener('news', (event) => {
      try {
        const newItems: NewsItem[] = JSON.parse(event.data);
        setLastUpdate(new Date());
        setIsLoading(false);
        
        setNewsData(prev => {
          const existingKeys = new Set(prev.map(item => `${item.title}-${item.publishedAt}`));
          const uniqueNewItems = newItems
            .filter(item => !existingKeys.has(`${item.title}-${item.publishedAt}`))
            .map(item => ({ ...item, isNew: prev.length > 0 }));
          
          if (uniqueNewItems.length === 0) return prev;
          
          const combined = [...uniqueNewItems, ...prev]
            .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
            .slice(0, 50);
          
          return combined;
        });
      } catch (error) {
        console.error('Error parsing news event:', error);
      }
    });

    eventSource.onerror = () => {
      setConnectionStatus('disconnected');
      retryTimeoutRef.current = setTimeout(() => {
        if (eventSourceRef.current) {
          connectToStream(symbol);
        }
      }, 5000);
    };

    return eventSource;
  }, [cleanupConnection]);

  useEffect(() => {
    if (isStreaming) {
      connectToStream(selectedSymbol);
      return () => {
        cleanupConnection();
        setConnectionStatus('disconnected');
      };
    } else {
      cleanupConnection();
      setConnectionStatus('disconnected');
    }
  }, [selectedSymbol, isStreaming, connectToStream, cleanupConnection]);

  useEffect(() => {
    setNewsData([]);
    seenNewsRef.current.clear();
  }, [selectedSymbol]);

  const filteredSymbols = watchlistSymbols.filter(s => 
    s.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getSentimentColor = (sentiment?: string) => {
    switch (sentiment) {
      case "positive": return "border-green-500/30 text-green-400 bg-green-500/10";
      case "negative": return "border-rose-500/30 text-rose-400 bg-rose-500/10";
      default: return "border-muted-foreground/30 text-muted-foreground bg-muted/10";
    }
  };

  return (
    <div className="space-y-5 h-[calc(100vh-6rem)] flex flex-col overflow-hidden">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500/30 to-violet-500/30 flex items-center justify-center">
              <Newspaper className="h-5 w-5 text-cyan-300" />
            </div>
            <span className="text-sm font-medium text-cyan-300/80">Market Intelligence</span>
          </div>
          <h1 className="text-4xl font-display font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">News Feed</h1>
          <p className="text-muted-foreground text-sm mt-1">Real-time financial news for your watchlist symbols</p>
        </div>
        <div className="flex gap-3 items-center">
          <div className="bg-gradient-to-br from-slate-500/10 to-slate-600/5 rounded-xl px-4 py-2 border border-slate-500/20 flex items-center gap-3">
            <span className={`inline-block w-2 h-2 rounded-full ${
              connectionStatus === 'connected' ? 'bg-emerald-500 animate-pulse' :
              connectionStatus === 'connecting' ? 'bg-amber-500 animate-pulse' :
              'bg-rose-500'
            }`} />
            <span className="text-xs text-muted-foreground font-mono">Updated: {lastUpdate.toLocaleTimeString()}</span>
          </div>
          <Button 
            variant={isStreaming ? "default" : "outline"}
            size="sm"
            className={`h-9 px-4 rounded-xl ${isStreaming ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-black/30 border-white/10'}`}
            onClick={() => setIsStreaming(!isStreaming)}
            data-testid="button-streaming"
          >
            <Radio className={`mr-2 h-3.5 w-3.5 ${isStreaming ? 'text-emerald-400 animate-pulse' : ''}`} />
            {isStreaming ? 'Live' : 'Paused'}
          </Button>
          <Button 
            variant="outline" 
            className="h-9 rounded-xl border-primary/30 hover:border-primary hover:bg-primary/10"
            onClick={() => {
              setNewsData([]);
              if (isStreaming) {
                connectToStream(selectedSymbol);
              }
            }}
            disabled={isLoading}
            data-testid="button-refresh"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 flex-1 min-h-0 overflow-hidden">
        {/* Watchlist Sidebar */}
        <Card className="glass rounded-2xl flex flex-col gradient-border overflow-hidden">
          <CardHeader className="border-b border-white/5 shrink-0 pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Star className="h-4 w-4 text-amber-400" /> Watchlist
            </CardTitle>
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search symbols..." 
                className="pl-9 bg-white/5 border-white/10 rounded-xl h-9 text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="input-search"
              />
            </div>
          </CardHeader>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {filteredSymbols.map((item) => (
                <button
                  key={item.symbol}
                  onClick={() => setSelectedSymbol(item.symbol)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                    selectedSymbol === item.symbol 
                      ? 'glass glow-soft' 
                      : 'hover:bg-white/5'
                  }`}
                  data-testid={`button-symbol-${item.symbol}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono font-bold text-sm ${selectedSymbol === item.symbol ? 'text-primary' : 'text-foreground'}`}>
                        {item.symbol}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-full border-muted-foreground/30">
                        {item.type}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground truncate block">{item.name}</span>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </Card>

        {/* News Feed */}
        <Card className="col-span-3 glass rounded-2xl flex flex-col gradient-border overflow-hidden">
          <CardHeader className="border-b border-white/5 shrink-0">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> 
              News for <span className="text-primary font-mono">{selectedSymbol}</span>
              {isLoading && <RefreshCw className="h-3 w-3 animate-spin ml-2" />}
              {connectionStatus === 'connected' && !isLoading && (
                <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-mono">LIVE</span>
              )}
            </CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <RefreshCw className="h-8 w-8 animate-spin mb-4 text-primary" />
                  <p className="font-mono text-sm">Fetching news...</p>
                </div>
              ) : newsData && newsData.length > 0 ? (
                newsData.map((news, i) => (
                  <a 
                    key={i} 
                    href={news.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="block glass rounded-xl p-4 hover:bg-white/10 transition-all group"
                    data-testid={`news-item-${i}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2 mb-2">
                          {news.title}
                        </h3>
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                          {news.summary}
                        </p>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-muted-foreground">{news.source}</span>
                          <span className="text-muted-foreground/50">•</span>
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-3 w-3" /> {formatTimeAgo(news.publishedAt)}
                          </span>
                          {news.sentiment && (
                            <>
                              <span className="text-muted-foreground/50">•</span>
                              <Badge variant="outline" className={`text-[10px] px-2 py-0 rounded-full ${getSentimentColor(news.sentiment)}`}>
                                {news.sentiment}
                              </Badge>
                            </>
                          )}
                        </div>
                      </div>
                      <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                    </div>
                  </a>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Newspaper className="h-12 w-12 mb-4 opacity-30" />
                  <p className="font-mono text-sm">No news found for {selectedSymbol}</p>
                  <p className="text-xs mt-2">Try selecting a different symbol or refresh</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}
