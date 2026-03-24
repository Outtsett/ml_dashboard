package com.mldashboard.motivewave.util;

import java.io.*;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

/**
 * Lightweight QuestDB ILP (InfluxDB Line Protocol) TCP client.
 * Sends OHLCV data directly to QuestDB port 9009, bypassing file I/O.
 *
 * ILP line format:
 *   tableName,tagKey=tagVal fieldKey=fieldVal[,fieldKey=fieldVal] timestamp_ns
 *
 * Example:
 *   ohlcv,symbol=MNQZ25 open=21500.0,high=21520.5,low=21490.0,close=21510.25,volume=1234i 1711440000000000000
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
