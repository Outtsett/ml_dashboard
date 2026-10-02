import { Router } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = Router();

/** One turn of the copilot conversation, as the Vercel AI SDK sends it. */
interface ChatMessage {
  role: string;
  content: string;
}

router.post('/chat', async (req, res) => {
  try {
    const messages: ChatMessage[] = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const latest = messages.at(-1);
    if (!latest) {
      return res.status(400).json({ error: "No messages supplied" });
    }
    
    // For Vercel AI SDK compatibility, we respond using the stream protocol.
    // Ensure you have GEMINI_API_KEY set in your .env
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    // Convert Vercel AI SDK messages to Gemini format
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));
    const lastMessage = latest.content;

    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(lastMessage);

    // Set headers for SSE streaming (Vercel AI SDK v3/v4 format)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Iterate through stream chunks and emit them
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        // Data Stream Protocol format: 0:"text content"\n
        res.write(`0:${JSON.stringify(text)}\n`);
      }
    }
    
    res.end();
  } catch (error) {
    console.error('[Copilot] Chat streaming error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.end();
    }
  }
});

export default router;
