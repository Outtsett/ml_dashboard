package com.mldashboard.motivewave.util;

import java.io.*;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * QuestDB ILP (InfluxDB Line Protocol) TCP client.
 *
 * ILP line format:
 *   tableName,tagKey=tagVal fieldKey=fieldVal[,fieldKey=fieldVal] timestamp_ns
 *
 * All lines include asset_class and root tags for unified multi-asset queries.
 *
 * Tables written:
 *   ohlcv       — bar data with orderflow (OHLCV + vwap, trades, delta)
 *   ticks       — individual ticks with BBO and exchange order IDs
 *   dom_l2      — per-level order book rows
 *   dom_summary — aggregated book state (spread, depth, imbalance)
 */
public class ILPClient implements Closeable {

    private final String host;
    private final int port;
    private Socket socket;
    private BufferedOutputStream out;
    private final StringBuilder lb = new StringBuilder(512);
    private int pendingLines;
    private long totalLinesSent;

    private static final int MAX_RETRIES = 3;
    private static final long RETRY_DELAY_MS = 1000;

    public ILPClient(String host, int port) {
        this.host = host;
        this.port = port;
    }

    // ── Connection ──────────────────────────────────────────────

    public void connect() throws IOException {
        for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                socket = new Socket(host, port);
                socket.setTcpNoDelay(true);
                socket.setSoTimeout(5000);
                out = new BufferedOutputStream(socket.getOutputStream(), 8192);
                return;
            } catch (IOException e) {
                if (attempt == MAX_RETRIES) throw e;
                try { Thread.sleep(RETRY_DELAY_MS); } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new IOException("Connection interrupted", ie);
                }
            }
        }
    }

    public boolean isConnected() {
        return socket != null && socket.isConnected() && !socket.isClosed();
    }

    public long getTotalLinesSent() { return totalLinesSent; }

    // ── OHLCV with orderflow ────────────────────────────────────

    /**
     * Enhanced OHLCV bar with orderflow fields from SDK Bar interface.
     * Fields: open, high, low, close, volume, vwap, trades,
     *         vol_at_bid, vol_at_ask, trades_at_bid, trades_at_ask
     */
    public void writeOHLCV(String table, String symbol, String assetClass, String root,
                           float open, float high, float low, float close,
                           long volume, float vwap, int trades,
                           float volAtBid, float volAtAsk,
                           int tradesAtBid, int tradesAtAsk,
                           long epochMs) throws IOException {
        lb.setLength(0);
        lb.append(esc(table));
        lb.append(",symbol=").append(esc(symbol));
        tag("asset_class", assetClass);
        tag("root", root);
        lb.append(' ');
        lb.append("open=").append(open);
        lb.append(",high=").append(high);
        lb.append(",low=").append(low);
        lb.append(",close=").append(close);
        lb.append(",volume=").append(volume).append('i');
        if (vwap != 0) lb.append(",vwap=").append(vwap);
        if (trades > 0) lb.append(",trades=").append(trades).append('i');
        if (volAtBid > 0) lb.append(",vol_at_bid=").append(volAtBid);
        if (volAtAsk > 0) lb.append(",vol_at_ask=").append(volAtAsk);
        if (tradesAtBid > 0) lb.append(",trades_at_bid=").append(tradesAtBid).append('i');
        if (tradesAtAsk > 0) lb.append(",trades_at_ask=").append(tradesAtAsk).append('i');
        lb.append(' ');
        lb.append(epochMs * 1_000_000L);
        lb.append('\n');
        send();
    }

    // ── Ticks with exchange order IDs ───────────────────────────

    /**
     * Tick with BBO snapshot and exchange order IDs.
     * Volume and sizes sent as integers (LONG) to match existing QuestDB schema.
     * Forex fractional lots are rounded to nearest int.
     */
    public void writeTick(String table, String symbol, String assetClass, String root,
                          float price, float volume, float bid, float ask,
                          float bidSize, float askSize, boolean isAskTick,
                          long exchOrderId, long aggExchOrderId,
                          long latencyMs,
                          long epochMs) throws IOException {
        lb.setLength(0);
        lb.append(esc(table));
        lb.append(",symbol=").append(esc(symbol));
        tag("asset_class", assetClass);
        tag("root", root);
        lb.append(",side=").append(isAskTick ? "ask" : "bid");
        lb.append(' ');
        lb.append("price=").append(price);
        lb.append(",volume=").append(Math.round(volume)).append('i');
        lb.append(",bid=").append(bid);
        lb.append(",ask=").append(ask);
        lb.append(",bid_size=").append(Math.round(bidSize)).append('i');
        lb.append(",ask_size=").append(Math.round(askSize)).append('i');
        lb.append(",spread=").append(ask - bid);
        if (exchOrderId != 0) lb.append(",exch_order_id=").append(exchOrderId).append('i');
        if (aggExchOrderId != 0) lb.append(",agg_exch_order_id=").append(aggExchOrderId).append('i');
        lb.append(' ');
        lb.append(epochMs * 1_000_000L);
        lb.append('\n');
        send();
    }

    // ── DOM Level 2 ─────────────────────────────────────────────

    public void writeDOMRow(String table, String symbol, String assetClass, String root,
                            String side, int level, float price, float size,
                            int orderCount, long epochMs) throws IOException {
        lb.setLength(0);
        lb.append(esc(table));
        lb.append(",symbol=").append(esc(symbol));
        tag("asset_class", assetClass);
        tag("root", root);
        lb.append(",side=").append(side);
        lb.append(' ');
        lb.append("level=").append(level).append('i');
        lb.append(",price=").append(price);
        lb.append(",size=").append(size);
        lb.append(",order_count=").append(orderCount).append('i');
        lb.append(' ');
        lb.append(epochMs * 1_000_000L);
        lb.append('\n');
        send();
    }

    public void writeDOMSummary(String table, String symbol, String assetClass, String root,
                                float bestBid, float bestAsk, float spread,
                                float totalBidSize, float totalAskSize,
                                int bidLevels, int askLevels,
                                float imbalance, long epochMs) throws IOException {
        lb.setLength(0);
        lb.append(esc(table));
        lb.append(",symbol=").append(esc(symbol));
        tag("asset_class", assetClass);
        tag("root", root);
        lb.append(' ');
        lb.append("best_bid=").append(bestBid);
        lb.append(",best_ask=").append(bestAsk);
        lb.append(",spread=").append(spread);
        lb.append(",total_bid_size=").append(totalBidSize);
        lb.append(",total_ask_size=").append(totalAskSize);
        lb.append(",bid_levels=").append(bidLevels).append('i');
        lb.append(",ask_levels=").append(askLevels).append('i');
        lb.append(",imbalance=").append(imbalance);
        lb.append(' ');
        lb.append(epochMs * 1_000_000L);
        lb.append('\n');
        send();
    }

    // ── Flush & Close ───────────────────────────────────────────

    public void flush() throws IOException {
        if (out != null && pendingLines > 0) {
            out.flush();
            pendingLines = 0;
        }
    }

    @Override
    public void close() throws IOException {
        try {
            if (out != null) { flush(); out.close(); }
        } finally {
            if (socket != null) socket.close();
        }
    }

    // ── Internal ────────────────────────────────────────────────

    private void tag(String key, String value) {
        if (value != null && !value.isEmpty()) {
            lb.append(',').append(key).append('=').append(esc(value));
        }
    }

    private void send() throws IOException {
        if (!isConnected()) connect();
        out.write(lb.toString().getBytes(StandardCharsets.UTF_8));
        pendingLines++;
        totalLinesSent++;
    }

    static String esc(String value) {
        if (value == null) return "";
        return value.replace(",", "\\,").replace(" ", "\\ ").replace("=", "\\=");
    }
}
