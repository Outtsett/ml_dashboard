package com.mldashboard.motivewave;

import com.mldashboard.motivewave.util.ILPClient;
import com.motivewave.platform.sdk.common.*;
import com.motivewave.platform.sdk.common.desc.*;
import com.motivewave.platform.sdk.study.Study;
import com.motivewave.platform.sdk.study.StudyHeader;

import java.io.IOException;

/**
 * MotiveWave study that streams OHLCV data directly to QuestDB via ILP TCP.
 * Achieves ~1-10ms latency by bypassing file I/O entirely.
 *
 * Add to any chart. On each bar close, the completed bar is sent via ILP TCP
 * to QuestDB port 9009. QuestDB dedup (UPSERT KEYS on ts + symbol) prevents
 * duplicate rows if the study is re-applied or MotiveWave restarts.
 */
@StudyHeader(
    namespace = "com.mldashboard",
    id = "QUESTDB_STREAM",
    name = "QuestDB ILP Stream",
    label = "QuestDB Stream",
    desc = "Streams OHLCV directly to QuestDB via ILP TCP (~1-10ms latency)",
    menu = "ML Dashboard",
    overlay = true,
    supportsBarUpdates = true,
    requiresBarUpdates = true
)
public class QuestDBStreamStudy extends Study {

    // Settings keys
    private static final String HOST = "questdbHost";
    private static final String PORT = "questdbPort";
    private static final String TABLE = "questdbTable";
    private static final String SEND_TICKS = "sendTicks";

    // Runtime state
    private ILPClient client;
    private int lastWrittenIndex = -1;
    private long totalBarsSent;
    private boolean connectionFailed;
    private int failCount;

    @Override
    public void initialize(Defaults defaults) {
        var sd = createSD();
        var tab = sd.addTab("Settings");

        tab.addGroup("QuestDB Connection",
            new StringDescriptor(HOST, "QuestDB Host", "localhost"),
            new IntegerDescriptor(PORT, "ILP TCP Port", 9009, 1, 65535, 1),
            new StringDescriptor(TABLE, "Table Name", "ohlcv"),
            new BooleanDescriptor(SEND_TICKS, "Also Stream Ticks", false)
        );
    }

    @Override
    public void onBarClose(DataContext ctx) {
        DataSeries series = ctx.getDataSeries();
        Instrument instrument = ctx.getInstrument();

        if (series == null || instrument == null) return;

        int lastIndex = series.size() - 2;
        if (lastIndex < 0 || lastIndex <= lastWrittenIndex) return;

        try {
            ensureClient();

            String symbol = instrument.getSymbol();
            String table = getSettings().getString(TABLE);
            if (table == null || table.isEmpty()) table = "ohlcv";

            long timestamp = series.getStartTime(lastIndex);
            float open = series.getOpen(lastIndex);
            float high = series.getHigh(lastIndex);
            float low = series.getLow(lastIndex);
            float close = series.getClose(lastIndex);
            long volume = series.getVolume(lastIndex);

            client.writeOHLCV(table, symbol, open, high, low, close, volume, timestamp);
            client.flush();

            lastWrittenIndex = lastIndex;
            totalBarsSent++;
            connectionFailed = false;
            failCount = 0;

            if (totalBarsSent % 100 == 0) {
                debug("QuestDB Stream: " + totalBarsSent + " bars sent for " + symbol);
            }
        } catch (IOException e) {
            handleConnectionError(e);
        }
    }

    @Override
    public void onTick(DataContext ctx, Tick tick) {
        if (!getSettings().is(SEND_TICKS, false)) return;
        // Tick streaming can be added later for sub-bar granularity
    }

    private void ensureClient() throws IOException {
        if (client == null || !client.isConnected()) {
            if (client != null) {
                try { client.close(); } catch (IOException ignored) {}
            }
            String host = getSettings().getString(HOST);
            if (host == null || host.isEmpty()) host = "localhost";
            int port = getSettings().getInt(PORT, 9009);
            client = new ILPClient(host, port);
            client.connect();
            info("QuestDB Stream: connected to " + host + ":" + port);
        }
    }

    private void handleConnectionError(IOException e) {
        failCount++;
        if (!connectionFailed || failCount % 10 == 0) {
            error("QuestDB Stream: connection error (" + failCount + "x): " + e.getMessage());
        }
        connectionFailed = true;

        // Close broken client so reconnect is attempted next bar
        if (client != null) {
            try { client.close(); } catch (IOException ignored) {}
            client = null;
        }
    }

    @Override
    public void clearState() {
        lastWrittenIndex = -1;
        totalBarsSent = 0;
        connectionFailed = false;
        failCount = 0;
        if (client != null) {
            try { client.close(); } catch (IOException ignored) {}
            client = null;
        }
    }
}
