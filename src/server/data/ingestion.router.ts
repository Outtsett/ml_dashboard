import { Router } from 'express';
import { Sender } from '@questdb/nodejs-client';
import { z } from 'zod';
import { queryRateLimiter } from '../infrastructure/lib/rateLimiter';
import { validateSymbol } from '@shared/schema';

const router = Router();

// `side` becomes a QuestDB SYMBOL column value — SYMBOL is for LOW-cardinality
// strings (per this project's QuestDB conventions), so it is constrained to a
// known set rather than accepting arbitrary caller text into the symbol table.
const TickRequest = z.object({
  symbol: z.string().min(1).transform((s, ctx) => {
    try {
      return validateSymbol(s);
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
      return z.NEVER;
    }
  }),
  price: z.number().finite().positive(),
  volume: z.number().finite().positive(),
  side: z.enum(['buy', 'sell', 'unknown']).optional(),
  // Seconds, matching the existing `* 1e6` -> microseconds conversion below.
  // Bounded to reject garbage far outside a plausible trading timestamp.
  timestamp: z.number().finite().positive().max(4102444800).optional(),
});

function formatZodErrors(error: z.ZodError): { error: string; details: unknown } {
  return {
    error: 'Invalid request',
    details: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: i.code,
    })),
  };
}

// Setup QuestDB ILP Sender (defaults to localhost:9009)
let sender: Sender | null = null;
Sender.fromConfig('http::addr=localhost:9000;').then(s => {
  sender = s;
}).catch(e => {
  console.warn("Failed to initialize QuestDB Sender. Is QuestDB running on port 9000/9009?", e);
});

router.post('/tick', queryRateLimiter, async (req, res) => {
  try {
    if (!sender) {
      return res.status(503).json({ error: "QuestDB Sender not initialized" });
    }

    const parsed = TickRequest.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(formatZodErrors(parsed.error));
    }
    const { symbol, price, volume, side, timestamp } = parsed.data;

    // Write to QuestDB via ILP. The Sender's default timestamp unit is
    // microseconds (@questdb/nodejs-client writeTimestamp's `unit = "us"`),
    // so a caller-supplied `timestamp` (validated seconds, above) is *1e6.
    // Date.now() is MILLISECONDS -- *1e3, not *1e6, or "now" lands ~58,000
    // years in the future in the live `ticks` table.
    await sender
      .table('ticks')
      .symbol('symbol', symbol)
      .symbol('side', side ?? 'unknown')
      .floatColumn('price', price)
      .floatColumn('volume', volume)
      .at(timestamp ? timestamp * 1e6 : Date.now() * 1e3);

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
