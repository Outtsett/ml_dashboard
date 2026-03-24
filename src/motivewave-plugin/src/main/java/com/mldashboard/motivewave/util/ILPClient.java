package com.mldashboard.motivewave.util;

import java.io.*;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

/**
 * Lightweight QuestDB ILP (InfluxDB Line Protocol) TCP client.
 * Sends OHLCV, tick, and Level 2 DOM data directly to QuestDB port 9009.
 *
 * ILP line format:
 *   tableName,tagKey=tagVal fieldKey=fieldVal[,fieldKey=fieldVal] timestamp_ns
 *
 * Tables written:
 *   ohlcv       — bar data (open, high, low, close, volume)
 *   ticks       — individual ticks (price, volume, bid, ask, bidSize, askSize)
 *   dom_l2      — depth of market snapshots (price, size, side, level per row)
 *   dom_summary — aggregated book snapshot (best bid/ask, total depth, spread)
 */
public class ILPClient implements Closeable {

    private final String host;
    private final int port;
    private Socket socket;
    private BufferedOutputStream out;
    private final StringBuilder lineBuffer = new StringBuilder(256);
    private int pendingLines;
    private long totalLinesSent;

    // Connection retry config
    private static final int MAX_RETRIES = 3;
    private static final long RETRY_DELAY_MS = 1000;

    public ILPClient(String host, int port) {
        this.host = host;
        this.port = port;
    }

    /**
     * Connect to QuestDB ILP TCP endpoint.
     */
    public void connect() throws IOException {
        for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                socket = new Socket(host, port);
                socket.setTcpNoDelay(true); // disable Nagle for low latency
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

    /**
     * Send a single OHLCV bar via ILP.
     *
     * @param table     QuestDB table name (e.g. "ohlcv")
     * @param symbol    Trading symbol (stored as SYMBOL column)
     * @param open      Bar open price
     * @param high      Bar high price
     * @param low       Bar low price
     * @param close     Bar close price
     * @param volume    Bar volume
     * @param epochMs   Bar timestamp in milliseconds since epoch
     */
    public void writeOHLCV(String table, String symbol, float open, float high,
                           float low, float close, long volume, long epochMs)
            throws IOException {
        lineBuffer.setLength(0);

        // table,symbol=SYM open=O,high=H,low=L,close=C,volume=Vi timestamp_ns
        lineBuffer.append(escapeTagValue(table));
        lineBuffer.append(",symbol=");
        lineBuffer.append(escapeTagValue(symbol));
        lineBuffer.append(' ');
        lineBuffer.append("open=").append(open);
        lineBuffer.append(",high=").append(high);
        lineBuffer.append(",low=").append(low);
        lineBuffer.append(",close=").append(close);
        lineBuffer.append(",volume=").append(volume).append('i');
        lineBuffer.append(' ');
        lineBuffer.append(epochMs * 1_000_000L); // ms → ns
        lineBuffer.append('\n');

        ensureConnected();
        out.write(lineBuffer.toString().getBytes(StandardCharsets.UTF_8));
        pendingLines++;
        totalLinesSent++;
    }

    /**
     * Send a single tick via ILP.
     */
    public void writeTick(String table, String symbol, float price, int volume,
                          float bid, float ask, int bidSize, int askSize,
                          boolean isAskTick, long epochMs) throws IOException {
        lineBuffer.setLength(0);
        lineBuffer.append(escapeTagValue(table));
        lineBuffer.append(",symbol=").append(escapeTagValue(symbol));
        lineBuffer.append(",side=").append(isAskTick ? "ask" : "bid");
        lineBuffer.append(' ');
        lineBuffer.append("price=").append(price);
        lineBuffer.append(",volume=").append(volume).append('i');
        lineBuffer.append(",bid=").append(bid);
        lineBuffer.append(",ask=").append(ask);
        lineBuffer.append(",bid_size=").append(bidSize).append('i');
        lineBuffer.append(",ask_size=").append(askSize).append('i');
        lineBuffer.append(",spread=").append(ask - bid);
        lineBuffer.append(' ');
        lineBuffer.append(epochMs * 1_000_000L);
        lineBuffer.append('\n');

        ensureConnected();
        out.write(lineBuffer.toString().getBytes(StandardCharsets.UTF_8));
        pendingLines++;
        totalLinesSent++;
    }

    /**
     * Send a single Level 2 DOM row via ILP.
     *
     * @param level  Depth level (0 = best bid/ask, 1 = next, etc.)
     */
    public void writeDOMRow(String table, String symbol, String side,
                            int level, float price, float size,
                            int orderCount, long epochMs) throws IOException {
        lineBuffer.setLength(0);
        lineBuffer.append(escapeTagValue(table));
        lineBuffer.append(",symbol=").append(escapeTagValue(symbol));
        lineBuffer.append(",side=").append(side);
        lineBuffer.append(' ');
        lineBuffer.append("level=").append(level).append('i');
        lineBuffer.append(",price=").append(price);
        lineBuffer.append(",size=").append(size);
        lineBuffer.append(",order_count=").append(orderCount).append('i');
        lineBuffer.append(' ');
        lineBuffer.append(epochMs * 1_000_000L);
        lineBuffer.append('\n');

        ensureConnected();
        out.write(lineBuffer.toString().getBytes(StandardCharsets.UTF_8));
        pendingLines++;
        totalLinesSent++;
    }

    /**
     * Send an aggregated DOM summary (spread, depth totals, imbalance) via ILP.
     */
    public void writeDOMSummary(String table, String symbol,
                                float bestBid, float bestAsk, float spread,
                                float totalBidSize, float totalAskSize,
                                int bidLevels, int askLevels,
                                float imbalance, long epochMs) throws IOException {
        lineBuffer.setLength(0);
        lineBuffer.append(escapeTagValue(table));
        lineBuffer.append(",symbol=").append(escapeTagValue(symbol));
        lineBuffer.append(' ');
        lineBuffer.append("best_bid=").append(bestBid);
        lineBuffer.append(",best_ask=").append(bestAsk);
        lineBuffer.append(",spread=").append(spread);
        lineBuffer.append(",total_bid_size=").append(totalBidSize);
        lineBuffer.append(",total_ask_size=").append(totalAskSize);
        lineBuffer.append(",bid_levels=").append(bidLevels).append('i');
        lineBuffer.append(",ask_levels=").append(askLevels).append('i');
        lineBuffer.append(",imbalance=").append(imbalance);
        lineBuffer.append(' ');
        lineBuffer.append(epochMs * 1_000_000L);
        lineBuffer.append('\n');

        ensureConnected();
        out.write(lineBuffer.toString().getBytes(StandardCharsets.UTF_8));
        pendingLines++;
        totalLinesSent++;
    }

    /**
     * Flush buffered lines to QuestDB.
     */
    public void flush() throws IOException {
        if (out != null && pendingLines > 0) {
            out.flush();
            pendingLines = 0;
        }
    }

    /**
     * Check if currently connected.
     */
    public boolean isConnected() {
        return socket != null && socket.isConnected() && !socket.isClosed();
    }

    public long getTotalLinesSent() {
        return totalLinesSent;
    }

    @Override
    public void close() throws IOException {
        try {
            if (out != null) {
                flush();
                out.close();
            }
        } finally {
            if (socket != null) {
                socket.close();
            }
        }
    }

    private void ensureConnected() throws IOException {
        if (!isConnected()) {
            connect();
        }
    }

    /**
     * Escape commas, spaces, and equals signs in tag keys/values per ILP spec.
     */
    private static String escapeTagValue(String value) {
        if (value == null) return "";
        return value.replace(",", "\\,")
                     .replace(" ", "\\ ")
                     .replace("=", "\\=");
    }
}
