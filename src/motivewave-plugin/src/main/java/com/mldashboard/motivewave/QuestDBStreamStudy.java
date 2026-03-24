package com.mldashboard.motivewave;

import com.mldashboard.motivewave.util.ILPClient;
import com.motivewave.platform.sdk.common.*;
import com.motivewave.platform.sdk.common.desc.*;
import com.motivewave.platform.sdk.study.Study;
import com.motivewave.platform.sdk.study.StudyHeader;

import java.io.IOException;
import java.util.List;

/**
 * MotiveWave study that streams OHLCV, tick, and Level 2 DOM data directly
 * to QuestDB via ILP TCP. Achieves ~1-10ms latency by bypassing file I/O.
 *
 * Tables created (auto by QuestDB ILP):
 *   ohlcv       — completed bar data
 *   ticks       — individual tick events with BBO
 *   dom_l2      — per-level order book rows
 *   dom_summary — aggregated book state (spread, depth, imbalance)
 *
 * DOM updates use Instrument.addListener(DOMListener) for real-time book data.
 */
@StudyHeader(
    namespace = "com.mldashboard",
    id = "QUESTDB_STREAM",
    name = "QuestDB ILP Stream",
    label = "QuestDB Stream",
    desc = "Streams OHLCV + ticks + Level 2 DOM to QuestDB via ILP TCP",
    menu = "ML Dashboard",
    overlay = true,
    supportsBarUpdates = true,
    requiresBarUpdates = true
)
public class QuestDBStreamStudy extends Study implements DOMListener {

    // Settings keys
    private static final String HOST = "questdbHost";
    private static final String PORT = "questdbPort";
    private static final String TABLE_OHLCV = "tableOhlcv";
    private static final String TABLE_TICKS = "tableTicks";
    private static final String TABLE_DOM = "tableDom";
    private static final String TABLE_DOM_SUMMARY = "tableDomSummary";
    private static final String SEND_TICKS = "sendTicks";
    private static final String SEND_DOM = "sendDom";
    private static final String DOM_DEPTH = "domDepth";
    private static final String DOM_THROTTLE_MS = "domThrottleMs";

    // Thread safety: update(DOM) fires on market data thread while
    // onTick/onBarClose fire on the study thread. All ILPClient access
    // must be synchronized through this lock.
    private final Object clientLock = new Object();

    // Runtime state (guarded by clientLock)
    private ILPClient client;
    private boolean connectionFailed;
    private int failCount;

    // Study-thread state (no sync needed — single-threaded access)
    private int lastWrittenIndex = -1;
    private Instrument subscribedInstrument;

    // Counters — volatile for cross-thread visibility in debug logging
    private volatile long totalBarsSent;
    private volatile long totalTicksSent;
    private volatile long totalDomUpdates;
    private volatile long lastDomSendTime;

    @Override
    public void initialize(Defaults defaults) {
        var sd = createSD();
        var tab = sd.addTab("Settings");

        tab.addGroup("QuestDB Connection",
            new StringDescriptor(HOST, "QuestDB Host", "localhost"),
            new IntegerDescriptor(PORT, "ILP TCP Port", 9009, 1, 65535, 1)
        );

        tab.addGroup("Table Names",
            new StringDescriptor(TABLE_OHLCV, "OHLCV Table", "ohlcv"),
            new StringDescriptor(TABLE_TICKS, "Ticks Table", "ticks"),
            new StringDescriptor(TABLE_DOM, "DOM L2 Table", "dom_l2"),
            new StringDescriptor(TABLE_DOM_SUMMARY, "DOM Summary Table", "dom_summary")
        );

        tab.addGroup("Data Streams",
            new BooleanDescriptor(SEND_TICKS, "Stream Ticks", true),
            new BooleanDescriptor(SEND_DOM, "Stream Level 2 DOM", true),
            new IntegerDescriptor(DOM_DEPTH, "DOM Depth (levels per side)", 10, 1, 50, 1),
            new IntegerDescriptor(DOM_THROTTLE_MS, "DOM Throttle (ms)", 100, 10, 5000, 10)
        );
    }

    @Override
    public void onBarClose(DataContext ctx) {
        DataSeries series = ctx.getDataSeries();
        Instrument instrument = ctx.getInstrument();

        if (series == null || instrument == null) return;
        subscribeToDom(instrument);

        int lastIndex = series.size() - 2;
        if (lastIndex < 0 || lastIndex <= lastWrittenIndex) return;

        // Read bar data outside the lock (DataSeries is study-thread only)
        String symbol = instrument.getSymbol();
        String table = getSetting(TABLE_OHLCV, "ohlcv");
        long timestamp = series.getStartTime(lastIndex);
        float open = series.getOpen(lastIndex);
        float high = series.getHigh(lastIndex);
        float low = series.getLow(lastIndex);
        float close = series.getClose(lastIndex);
        long volume = series.getVolume(lastIndex);

        synchronized (clientLock) {
            try {
                ensureClient();
                client.writeOHLCV(table, symbol, open, high, low, close, volume, timestamp);
                client.flush();
                connectionFailed = false;
                failCount = 0;
            } catch (IOException e) {
                handleConnectionError(e);
                return;
            }
        }

        lastWrittenIndex = lastIndex;
        totalBarsSent++;

        if (totalBarsSent % 100 == 0) {
            debug("QuestDB Stream: " + totalBarsSent + " bars, "
                + totalTicksSent + " ticks, " + totalDomUpdates + " DOM snapshots"
                + " for " + symbol);
        }
    }

    @Override
    public void onTick(DataContext ctx, Tick tick) {
        if (!getSettings().is(SEND_TICKS, true)) return;
        if (tick == null) return;

        Instrument instrument = ctx.getInstrument();
        if (instrument == null) return;
        subscribeToDom(instrument);

        String symbol = instrument.getSymbol();
        String table = getSetting(TABLE_TICKS, "ticks");

        synchronized (clientLock) {
            try {
                ensureClient();
                client.writeTick(table, symbol,
                    tick.getPrice(), tick.getVolume(),
                    tick.getBidPrice(), tick.getAskPrice(),
                    tick.getBidSize(), tick.getAskSize(),
                    tick.isAskTick(), tick.getTime());

                totalTicksSent++;

                // Batch flush ticks every 50 to reduce syscalls
                if (totalTicksSent % 50 == 0) {
                    client.flush();
                }
            } catch (IOException e) {
                handleConnectionError(e);
            }
        }
    }

    /**
     * DOMListener callback — fired on every order book update from the exchange.
     * Streams per-level rows + an aggregated summary to QuestDB.
     */
    @Override
    public void update(DOM dom) {
        if (!getSettings().is(SEND_DOM, true)) return;
        if (dom == null) return;

        // Throttle DOM updates to avoid flooding QuestDB
        long now = System.currentTimeMillis();
        int throttleMs = getSettings().getInt(DOM_THROTTLE_MS, 100);
        if (now - lastDomSendTime < throttleMs) return;
        lastDomSendTime = now;

        Instrument instrument = dom.getInstrument();
        if (instrument == null) return;

        try {
            String symbol = instrument.getSymbol();
            String domTable = getSetting(TABLE_DOM, "dom_l2");
            String summaryTable = getSetting(TABLE_DOM_SUMMARY, "dom_summary");
            int maxDepth = getSettings().getInt(DOM_DEPTH, 10);

            List<?> bidRows = dom.getBidRows();
            List<?> askRows = dom.getAskRows();

            float totalBidSize = 0;
            float totalAskSize = 0;
            float bestBid = 0;
            float bestAsk = 0;

            // Pre-compute sizes outside the lock
            int bidLevels = bidRows != null ? Math.min(bidRows.size(), maxDepth) : 0;
            int askLevels = askRows != null ? Math.min(askRows.size(), maxDepth) : 0;

            synchronized (clientLock) {
                ensureClient();

                // Stream bid levels
                if (bidRows != null) {
                    for (int i = 0; i < bidLevels; i++) {
                        DOMRow row = (DOMRow) bidRows.get(i);
                        float price = row.getPrice();
                        float size = row.getSize();
                        int orderCount = row.getOrderCount();

                        client.writeDOMRow(domTable, symbol, "bid",
                            i, price, size, orderCount, now);

                        totalBidSize += size;
                        if (i == 0) bestBid = price;
                    }
                }

                // Stream ask levels
                if (askRows != null) {
                    for (int i = 0; i < askLevels; i++) {
                        DOMRow row = (DOMRow) askRows.get(i);
                        float price = row.getPrice();
                        float size = row.getSize();
                        int orderCount = row.getOrderCount();

                        client.writeDOMRow(domTable, symbol, "ask",
                            i, price, size, orderCount, now);

                        totalAskSize += size;
                        if (i == 0) bestAsk = price;
                    }
                }

                // Compute and send summary
                float spread = (bestAsk > 0 && bestBid > 0) ? bestAsk - bestBid : 0;
                float totalSize = totalBidSize + totalAskSize;
                float imbalance = totalSize > 0
                    ? (totalBidSize - totalAskSize) / totalSize
                    : 0;

                client.writeDOMSummary(summaryTable, symbol,
                    bestBid, bestAsk, spread,
                    totalBidSize, totalAskSize,
                    bidLevels, askLevels,
                    imbalance, now);

                client.flush();
                connectionFailed = false;
                failCount = 0;
            }

            totalDomUpdates++;

        } catch (IOException e) {
            synchronized (clientLock) {
                handleConnectionError(e);
            }
        }
    }

    /**
     * Subscribe to DOM updates for this instrument (once).
     */
    private void subscribeToDom(Instrument instrument) {
        if (subscribedInstrument != null) return;
        if (!getSettings().is(SEND_DOM, true)) return;

        instrument.addListener(this);
        subscribedInstrument = instrument;
        info("QuestDB Stream: subscribed to Level 2 DOM for " + instrument.getSymbol());
    }

    private String getSetting(String key, String defaultVal) {
        String val = getSettings().getString(key);
        return (val != null && !val.isEmpty()) ? val : defaultVal;
    }

    private void ensureClient() throws IOException {
        if (client == null || !client.isConnected()) {
            if (client != null) {
                try { client.close(); } catch (IOException ignored) {}
            }
            String host = getSetting(HOST, "localhost");
            int port = getSettings().getInt(PORT, 9009);
            client = new ILPClient(host, port);
            client.connect();
            info("QuestDB Stream: connected to " + host + ":" + port);
        }
    }

    private void handleConnectionError(IOException e) {
        // Called inside synchronized(clientLock) — no additional lock needed
        failCount++;
        if (!connectionFailed || failCount % 10 == 0) {
            error("QuestDB Stream: connection error (" + failCount + "x): " + e.getMessage());
        }
        connectionFailed = true;

        if (client != null) {
            try { client.close(); } catch (IOException ignored) {}
            client = null;
        }
    }

    @Override
    public void clearState() {
        lastWrittenIndex = -1;
        totalBarsSent = 0;
        totalTicksSent = 0;
        totalDomUpdates = 0;
        lastDomSendTime = 0;

        // Unsubscribe from DOM (study-thread only)
        if (subscribedInstrument != null) {
            subscribedInstrument.removeListener((DOMListener) this);
            subscribedInstrument = null;
        }

        synchronized (clientLock) {
            connectionFailed = false;
            failCount = 0;
            if (client != null) {
                try { client.close(); } catch (IOException ignored) {}
                client = null;
            }
        }
    }
}
