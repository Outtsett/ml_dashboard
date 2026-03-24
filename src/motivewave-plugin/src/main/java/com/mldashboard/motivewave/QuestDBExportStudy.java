package com.mldashboard.motivewave;

import com.motivewave.platform.sdk.common.*;
import com.motivewave.platform.sdk.common.desc.*;
import com.motivewave.platform.sdk.study.Study;
import com.motivewave.platform.sdk.study.StudyHeader;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.TimeZone;

/**
 * MotiveWave study that exports OHLCV bar data to CSV files on every bar close.
 * The ML Dashboard file watcher picks up these CSVs and ingests them into QuestDB.
 *
 * CSV format matches the MotiveWave export format our parser already handles:
 *   Date,Time,Open,High,Low,Close,Volume
 *
 * Usage:
 *   1. Add this study to any chart in MotiveWave
 *   2. Configure the export directory (default: user home / motivewave-export)
 *   3. The ML Dashboard watcher auto-detects new/changed files and ingests
 */
@StudyHeader(
    namespace = "com.mldashboard",
    id = "QUESTDB_EXPORT",
    name = "QuestDB CSV Export",
    label = "QuestDB Export",
    desc = "Exports OHLCV data to CSV for ML Dashboard ingestion",
    menu = "ML Dashboard",
    overlay = true,
    supportsBarUpdates = true,
    requiresBarUpdates = true
)
public class QuestDBExportStudy extends Study {

    // Settings keys
    private static final String EXPORT_DIR = "exportDir";
    private static final String APPEND_MODE = "appendMode";
    private static final String INCLUDE_HEADER = "includeHeader";
    private static final String FLUSH_INTERVAL = "flushInterval";

    // Runtime state
    private Path exportPath;
    private SimpleDateFormat dateFormat;
    private SimpleDateFormat timeFormat;
    private int barsWritten;
    private int lastWrittenIndex = -1;

    @Override
    public void initialize(Defaults defaults) {
        var sd = createSD();
        var tab = sd.addTab("Settings");

        tab.addGroup("Export Configuration",
            new StringDescriptor(EXPORT_DIR, "Export Directory",
                getDefaultExportDir()),
            new BooleanDescriptor(APPEND_MODE, "Append Mode (vs Full Export)",
                true),
            new BooleanDescriptor(INCLUDE_HEADER, "Include CSV Header",
                true),
            new IntegerDescriptor(FLUSH_INTERVAL, "Flush Every N Bars",
                1, 1, 100, 1)
        );

        // Date/time formatters (UTC)
        dateFormat = new SimpleDateFormat("MM/dd/yyyy");
        dateFormat.setTimeZone(TimeZone.getTimeZone("UTC"));
        timeFormat = new SimpleDateFormat("HH:mm");
        timeFormat.setTimeZone(TimeZone.getTimeZone("UTC"));
    }

    @Override
    public void onBarClose(DataContext ctx) {
        DataSeries series = ctx.getDataSeries();
        Instrument instrument = ctx.getInstrument();

        if (series == null || instrument == null) return;

        int lastIndex = series.size() - 2; // -2 because current bar is incomplete
        if (lastIndex < 0 || lastIndex <= lastWrittenIndex) return;

        try {
            ensureExportPath();

            String symbol = sanitizeSymbol(instrument.getSymbol());
            BarSize barSize = series.getBarSize();
            String timeframe = formatBarSize(barSize);
            String fileName = symbol + " - " + timeframe + ".csv";
            Path filePath = exportPath.resolve(fileName);

            boolean appendMode = getSettings().is(APPEND_MODE, true);
            boolean includeHeader = getSettings().is(INCLUDE_HEADER, true);
            boolean fileExists = Files.exists(filePath);

            if (appendMode) {
                writeBarAppend(filePath, series, lastIndex, includeHeader && !fileExists);
            } else {
                writeFullExport(filePath, series, includeHeader);
            }

            lastWrittenIndex = lastIndex;
            barsWritten++;

            int flushInterval = getSettings().getInt(FLUSH_INTERVAL, 1);
            if (barsWritten % (flushInterval * 10) == 0) {
                debug("QuestDB Export: " + barsWritten + " bars written to " + fileName);
            }
        } catch (Exception e) {
            error("QuestDB Export error: " + e.getMessage());
        }
    }

    /**
     * Appends a single bar to the CSV file.
     */
    private void writeBarAppend(Path filePath, DataSeries series, int index,
                                boolean writeHeader) throws IOException {
        try (BufferedWriter writer = Files.newBufferedWriter(filePath,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND)) {

            if (writeHeader) {
                writer.write("Date,Time,Open,High,Low,Close,Volume");
                writer.newLine();
            }

            writeBar(writer, series, index);
        }
    }

    /**
     * Writes the full data series to CSV (overwrite mode).
     */
    private void writeFullExport(Path filePath, DataSeries series,
                                 boolean writeHeader) throws IOException {
        try (BufferedWriter writer = Files.newBufferedWriter(filePath,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING)) {

            if (writeHeader) {
                writer.write("Date,Time,Open,High,Low,Close,Volume");
                writer.newLine();
            }

            for (int i = series.getStartIndex(); i < series.size() - 1; i++) {
                writeBar(writer, series, i);
            }
        }
    }

    /**
     * Writes a single bar in MotiveWave CSV format.
     */
    private void writeBar(BufferedWriter writer, DataSeries series, int index)
            throws IOException {
        long timestamp = series.getStartTime(index);
        float open = series.getOpen(index);
        float high = series.getHigh(index);
        float low = series.getLow(index);
        float close = series.getClose(index);
        long volume = series.getVolume(index);

        Date date = new Date(timestamp);
        writer.write(dateFormat.format(date));
        writer.write(',');
        writer.write(timeFormat.format(date));
        writer.write(',');
        writer.write(String.valueOf(open));
        writer.write(',');
        writer.write(String.valueOf(high));
        writer.write(',');
        writer.write(String.valueOf(low));
        writer.write(',');
        writer.write(String.valueOf(close));
        writer.write(',');
        writer.write(String.valueOf(volume));
        writer.newLine();
    }

    private void ensureExportPath() throws IOException {
        if (exportPath == null) {
            String dir = getSettings().getString(EXPORT_DIR);
            if (dir == null || dir.isEmpty()) dir = getDefaultExportDir();
            exportPath = Paths.get(dir);
            Files.createDirectories(exportPath);
            info("QuestDB Export: writing to " + exportPath);
        }
    }

    /**
     * Converts BarSize to a human-readable timeframe string matching
     * MotiveWave's file naming convention.
     */
    private String formatBarSize(BarSize barSize) {
        if (barSize == null) return "Unknown";

        long millis = barSize.getSizeMillis();
        if (millis <= 0) return "Tick";
        if (millis < 60_000) return (millis / 1000) + " sec";
        if (millis < 3_600_000) return (millis / 60_000) + " min";
        if (millis < 86_400_000) return (millis / 3_600_000) + " hour";
        if (millis == 86_400_000) return "Daily";
        if (millis <= 604_800_000) return "Weekly";
        return "Monthly";
    }

    /**
     * Sanitize symbol for filesystem use.
     */
    private String sanitizeSymbol(String symbol) {
        if (symbol == null) return "UNKNOWN";
        return symbol.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private String getDefaultExportDir() {
        return System.getProperty("user.home") + File.separator + "motivewave-export";
    }

    @Override
    public void clearState() {
        lastWrittenIndex = -1;
        barsWritten = 0;
    }
}
