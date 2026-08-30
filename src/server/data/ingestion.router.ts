import { Router } from 'express';
import { Sender } from '@questdb/nodejs-client';

const router = Router();

// Setup QuestDB ILP Sender (defaults to localhost:9009)
let sender: Sender | null = null;
Sender.fromConfig('http::addr=localhost:9000;').then(s => {
  sender = s;
}).catch(e => {
  console.warn("Failed to initialize QuestDB Sender. Is QuestDB running on port 9000/9009?", e);
});

router.post('/tick', async (req, res) => {
  try {
    if (!sender) {
      return res.status(503).json({ error: "QuestDB Sender not initialized" });
    }

    const { symbol, price, volume, side, timestamp } = req.body;
    
    if (!symbol || price == null || volume == null) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Write to QuestDB via ILP
    await sender
      .table('ticks')
      .symbol('symbol', symbol)
      .symbol('side', side || 'unknown')
      .floatColumn('price', price)
      .floatColumn('volume', volume)
      .at(timestamp ? timestamp * 1e6 : Date.now() * 1e6); // Microseconds for timestamp
    
    // Flush immediately for this endpoint (in prod, you'd batch and flush periodically)
    await sender.flush();

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Ingestion] Error writing to QuestDB:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Close sender on exit
process.on('SIGINT', async () => {
  if (sender) {
    await sender.close();
  }
});

export default router;
