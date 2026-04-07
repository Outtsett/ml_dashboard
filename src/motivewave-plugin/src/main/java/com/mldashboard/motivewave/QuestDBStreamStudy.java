package com.mldashboard.motivewave;

import com.mldashboard.motivewave.util.ILPClient;
import com.motivewave.platform.sdk.common.*;
import com.motivewave.platform.sdk.common.desc.*;
import com.motivewave.platform.sdk.study.Study;
import com.motivewave.platform.sdk.study.StudyHeader;

import java.io.IOException;
import java.util.List;

/**
 * Streams OHLCV (with orderflow), ticks (with exchange IDs), and Level 2
 * DOM data to QuestDB via ILP TCP. All rows tagged with asset_class/root
 * derived from the SDK's Instrument.getType() enum.
 *
 * Tables (auto-created by QuestDB ILP):
 *   ohlcv       — bars with vwap, trades, volume at bid/ask
 *   ticks       — ticks with BBO, spread, exchange order IDs
 *   dom_l2      — per-level book rows (price, size, order count)
 *   dom_summary — aggregated book (spread, depth, imbalance)
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
    requiresBarUpdates = true,
    requiresBidAskHistory = true
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

    // Thread safety: update(DOM) fires on market data thread
    private final Object clientLock = new Object();

    // Runtime state (guarded by clientLock)
    private ILPClient client;
    private boolean connectionFailed;
    private int failCount;

    // Study-thread state
    private int lastWrittenIndex = -1;
    private Instrument subscribedInstrument;

    // Cached asset classification from SDK Instrument.getType()
    private volatile String cachedAssetClass;
    private volatile String cachedRoot;

    // Counters
    private volatile long totalBarsSent;
    private volatile long totalTicksSent;
    private volatile long totalDomUpdates;
    private volatile long lastDomSendTime;
    private volatile long lastTickFlushTime;

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

    // ── Bar Close ───────────────────────────────────────────────

    @Override
    public void onBarClose(DataContext ctx) {
        DataSeries series = ctx.getDataSeries();
        Instrument instrument = ctx.getInstrument();
        if (series == null || instrument == null) return;
        subscribeToDom(instrument);

        int idx = series.size() - 2;
        if (idx < 0 || idx <= lastWrittenIndex) return;

        String symbol = instrument.getSymbol();
        resolveAssetFields(instrument);
        String table = setting(TABLE_OHLCV, "ohlcv");

        long timestamp = series.getStartTime(idx);
        float open = series.getOpen(idx);
        float high = series.getHigh(idx);
        float low = series.getLow(idx);
        float close = series.getClose(idx);
        long volume = series.getVolume(idx);

        // Orderflow fields from SDK Bar — fetch via historical bars
        float vwap = 0;
        int trades = 0;
        float volAtBid = 0, volAtAsk = 0;
        int tradesAtBid = 0, tradesAtAsk = 0;
        try {
            List<Bar> bars = instrument.getBars(timestamp, 1, series.getBarSize(), false);
            if (bars != null && !bars.isEmpty()) {
                Bar bar = bars.get(0);
                vwap = bar.getVWAP();
                trades = bar.getTrades();
                volAtBid = bar.getVolumeAtBid();
                volAtAsk = bar.getVolumeAtOffer();
                tradesAtBid = bar.getTradesAtBid();
                tradesAtAsk = bar.getTradesAtOffer();
            }
        } catch (Exception e) {
            // Orderflow fields unavailable — send without them
        }

        synchronized (clientLock) {
            try {
                ensureClient();
                client.writeOHLCV(table, symbol, cachedAssetClass, cachedRoot,
                    open, high, low, close, volume,
                    vwap, trades, volAtBid, volAtAsk, tradesAtBid, tradesAtAsk,
                    timestamp);
                client.flush();
                connectionFailed = false;
                failCount = 0;
            } catch (IOException e) {
                handleConnectionError(e);
                return;
            }
        }

        lastWrittenIndex = idx;
        totalBarsSent++;

        if (totalBarsSent % 100 == 0) {
            debug("QuestDB: " + totalBarsSent + " bars, " + totalTicksSent + " ticks, "
                + totalDomUpdates + " DOM [" + cachedAssetClass + "/" + cachedRoot + "]");
        }
    }

    // ── Ticks ───────────────────────────────────────────────────

    @Override
    public void onTick(DataContext ctx, Tick tick) {
        if (!getSettings().is(SEND_TICKS, true) || tick == null) return;
        Instrument instrument = ctx.getInstrument();
        if (instrument == null) return;
        subscribeToDom(instrument);

        String symbol = instrument.getSymbol();
        resolveAssetFields(instrument);
        String table = setting(TABLE_TICKS, "ticks");

        // Use float accessors for forex fractional lot support
        float price = tick.getPrice();
        float volume = tick.getVolumeAsFloat();
        float bid = tick.getBidPrice();
        float ask = tick.getAskPrice();
        float bidSize = tick.getBidSizeAsFloat();
        float askSize = tick.getAskSizeAsFloat();
        boolean isAsk = tick.isAskTick();
        long exchId = tick.getExchOrderId();
        long aggId = tick.getAggExchOrderId();
        long time = tick.getTime();
        long latencyMs = System.currentTimeMillis() - time;

        synchronized (clientLock) {
            try {
                ensureClient();
                client.writeTick(table, symbol, cachedAssetClass, cachedRoot,
                    price, volume, bid, ask, bidSize, askSize, isAsk,
                    exchId, aggId, latencyMs, time);

                totalTicksSent++;
                // Flush every 50 ticks or if >2s since last flush
                if (totalTicksSent % 50 == 0
                    || (System.currentTimeMillis() - lastTickFlushTime) > 2000) {
                    client.flush();
                    lastTickFlushTime = System.currentTimeMillis();
                }
            } catch (IOException e) {
                handleConnectionError(e);
            }
        }
    }

    // ── DOM (Level 2) ───────────────────────────────────────────

    @Override
    public void update(DOM dom) {
        if (!getSettings().is(SEND_DOM, true) || dom == null) return;

        long now = System.currentTimeMillis();
        int throttleMs = getSettings().getInt(DOM_THROTTLE_MS, 100);
        if (now - lastDomSendTime < throttleMs) return;
        lastDomSendTime = now;

        Instrument instrument = dom.getInstrument();
        if (instrument == null) return;

        try {
            String symbol = instrument.getSymbol();
            resolveAssetFields(instrument);
            String ac = cachedAssetClass;
            String rt = cachedRoot;
            String domTable = setting(TABLE_DOM, "dom_l2");
            String summaryTable = setting(TABLE_DOM_SUMMARY, "dom_summary");
            int maxDepth = getSettings().getInt(DOM_DEPTH, 10);

            List<?> bidRows = dom.getBidRows();
            List<?> askRows = dom.getAskRows();

            float totalBidSize = 0, totalAskSize = 0;
            float bestBid = 0, bestAsk = 0;

            int bidLevels = bidRows != null ? Math.min(bidRows.size(), maxDepth) : 0;
            int askLevels = askRows != null ? Math.min(askRows.size(), maxDepth) : 0;

            synchronized (clientLock) {
                ensureClient();

                if (bidRows != null) {
                    for (int i = 0; i < bidLevels; i++) {
                        DOMRow row = (DOMRow) bidRows.get(i);
                        float price = row.getPrice();
                        float size = row.getSize();
                        int orderCount = row.getOrderCount();
                        client.writeDOMRow(domTable, symbol, ac, rt, "bid",
                            i, price, size, orderCount, now);
                        totalBidSize += size;
                        if (i == 0) bestBid = price;
                    }
                }

                if (askRows != null) {
                    for (int i = 0; i < askLevels; i++) {
                        DOMRow row = (DOMRow) askRows.get(i);
                        float price = row.getPrice();
                        float size = row.getSize();
                        int orderCount = row.getOrderCount();
                        client.writeDOMRow(domTable, symbol, ac, rt, "ask",
                            i, price, size, orderCount, now);
                        totalAskSize += size;
                        if (i == 0) bestAsk = price;
                    }
                }

                float spread = (bestAsk > 0 && bestBid > 0) ? bestAsk - bestBid : 0;
                float totalSize = totalBidSize + totalAskSize;
                float imbalance = totalSize > 0
                    ? (totalBidSize - totalAskSize) / totalSize : 0;

                client.writeDOMSummary(summaryTable, symbol, ac, rt,
                    bestBid, bestAsk, spread,
                    totalBidSize, totalAskSize,
                    bidLevels, askLevels, imbalance, now);

                client.flush();
                connectionFailed = false;
                failCount = 0;
            }

            totalDomUpdates++;

        } catch (IOException e) {
            synchronized (clientLock) { handleConnectionError(e); }
        }
    }

    // ── Lifecycle ───────────────────────────────────────────────

    private void subscribeToDom(Instrument instrument) {
        if (subscribedInstrument != null) return;
        if (!getSettings().is(SEND_DOM, true)) return;
        instrument.addListener(this);
        subscribedInstrument = instrument;
        info("QuestDB: subscribed to Level 2 DOM for " + instrument.getSymbol());
    }

    /**
     * Derive asset_class and root from SDK Instrument.getType() enum.
     * Uses string comparison because the SDK's Enums.InstrumentType is
     * not directly resolvable at compile time (obfuscated inner class).
     */
    private void resolveAssetFields(Instrument instrument) {
        if (cachedAssetClass != null) return;

        String symbol = instrument.getSymbol();
        String typeName = "";
        try {
            Object type = instrument.getType();
            if (type != null) typeName = type.toString().toUpperCase();
        } catch (Exception e) {
            // getType() unavailable — fall through to pattern matching
        }

        switch (typeName) {
            case "FOREX":
                cachedAssetClass = "forex";
                cachedRoot = symbol.toUpperCase();
                break;
            case "FUTURE":
            case "FUTURE_OPTION":
                cachedAssetClass = "futures";
                String s = symbol.toUpperCase();
                String root = s.replaceAll("[FGHJKMNQUVXZ]\\d{1,2}$", "");
                cachedRoot = root.isEmpty() ? s : root;
                break;
            case "CRYPTO_CURRENCY":
            case "CRYPTO_SCFUT":
            case "CRYPTO_MCFUT":
                cachedAssetClass = "crypto";
                cachedRoot = symbol.toUpperCase();
                break;
            case "STOCK":
            case "INDEX":
            case "CFD":
                cachedAssetClass = "equity";
                cachedRoot = symbol.toUpperCase();
                break;
            default:
                // Unknown — fall back to regex pattern matching
                cachedAssetClass = "futures";
                cachedRoot = symbol.toUpperCase().replaceAll("[FGHJKMNQUVXZ]\\d{1,2}$", "");
                if (cachedRoot.isEmpty()) cachedRoot = symbol.toUpperCase();
                break;
        }

        info("QuestDB: " + symbol + " → " + cachedAssetClass + "/" + cachedRoot
            + " (SDK type: " + typeName + ")");
    }

    private String setting(String key, String defaultVal) {
        String val = getSettings().getString(key);
        return (val != null && !val.isEmpty()) ? val : defaultVal;
    }

    private void ensureClient() throws IOException {
        if (client == null || !client.isConnected()) {
            if (client != null) {
                try { client.close(); } catch (IOException ignored) {}
            }
            String host = setting(HOST, "localhost");
            int port = getSettings().getInt(PORT, 9009);
            client = new ILPClient(host, port);
            client.connect();
            info("QuestDB: connected to " + host + ":" + port);
        }
    }

    private void handleConnectionError(IOException e) {
        failCount++;
        if (!connectionFailed || failCount % 10 == 0) {
            error("QuestDB: connection error (" + failCount + "x): " + e.getMessage());
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
        lastTickFlushTime = 0;
        cachedAssetClass = null;
        cachedRoot = null;

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

    @Override
    public void destroy() {
        clearState();
    }
}
