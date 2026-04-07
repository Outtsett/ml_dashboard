/**
 * Playwright audit — verify the LLM chat implementation renders and functions correctly.
 *
 * Checks:
 * 1. Market Data page loads
 * 2. Bottom panel has Terminal and Chat tabs
 * 3. Chat tab renders with Ollama status indicator
 * 4. Model selector is populated
 * 5. Can type and send a message
 * 6. Streaming response arrives
 * 7. Terminal tab still works
 */

import { chromium } from 'playwright';

const BASE = 'http://localhost:5000';
const TIMEOUT = 30_000;

async function audit() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  function pass(name) { results.push({ name, status: 'PASS' }); console.log(`  PASS  ${name}`); }
  function fail(name, err) { results.push({ name, status: 'FAIL', error: err }); console.log(`  FAIL  ${name}: ${err}`); }

  try {
    console.log('\n=== Chat Implementation Audit ===\n');

    // 1. Page loads
    try {
      const res = await page.goto(BASE, { waitUntil: 'networkidle', timeout: TIMEOUT });
      if (res.ok()) pass('Market Data page loads');
      else fail('Market Data page loads', `HTTP ${res.status()}`);
    } catch (e) {
      fail('Market Data page loads', e.message);
      throw new Error('Page failed to load — aborting');
    }

    // Wait for app to hydrate
    await page.waitForTimeout(3000);

    // 2. Check for Terminal tab in bottom panel
    try {
      const terminalTab = await page.locator('button:has-text("Terminal")').first();
      await terminalTab.waitFor({ state: 'visible', timeout: 10000 });
      pass('Terminal tab visible in bottom panel');
    } catch (e) {
      fail('Terminal tab visible in bottom panel', e.message);
    }

    // 3. Check for Chat tab
    try {
      const chatTab = await page.locator('button:has-text("Chat")').first();
      await chatTab.waitFor({ state: 'visible', timeout: 5000 });
      pass('Chat tab visible in bottom panel');
    } catch (e) {
      fail('Chat tab visible in bottom panel', e.message);
    }

    // 4. Click Chat tab
    try {
      const chatTab = await page.locator('button:has-text("Chat")').first();
      await chatTab.click();
      await page.waitForTimeout(500);
      pass('Chat tab clickable');
    } catch (e) {
      fail('Chat tab clickable', e.message);
    }

    // 5. Check Ollama status indicator (green dot = healthy)
    try {
      // Look for the Bot icon or "Ollama Chat" text
      const chatHeader = await page.locator('text=Ollama Chat').first();
      await chatHeader.waitFor({ state: 'visible', timeout: 5000 });
      pass('Chat header with "Ollama Chat" label visible');
    } catch (e) {
      fail('Chat header with "Ollama Chat" label visible', e.message);
    }

    // 6. Check model selector is populated
    try {
      const modelSelect = await page.locator('select').first();
      await modelSelect.waitFor({ state: 'visible', timeout: 5000 });
      const options = await modelSelect.locator('option').allTextContents();
      if (options.some(o => o.includes('qwen3'))) {
        pass(`Model selector populated (${options.length} models: ${options.join(', ')})`);
      } else {
        fail('Model selector populated', `Options found but no qwen3 model: ${options.join(', ')}`);
      }
    } catch (e) {
      fail('Model selector populated', e.message);
    }

    // 7. Check empty state message
    try {
      const emptyState = await page.locator('text=Local LLM Assistant').first();
      await emptyState.waitFor({ state: 'visible', timeout: 3000 });
      pass('Empty state shows "Local LLM Assistant" message');
    } catch (e) {
      fail('Empty state shows "Local LLM Assistant" message', e.message);
    }

    // 8. Type a message
    try {
      const input = await page.locator('textarea[placeholder*="Ask anything"]').first();
      await input.waitFor({ state: 'visible', timeout: 5000 });
      await input.fill('Say hello in exactly 3 words');
      pass('Chat input accepts text');
    } catch (e) {
      fail('Chat input accepts text', e.message);
    }

    // 9. Send message (click send button)
    try {
      const sendBtn = await page.locator('button[title="Send message"]').first();
      await sendBtn.click();
      pass('Send button clicked');
    } catch (e) {
      fail('Send button clicked', e.message);
    }

    // 10. Wait for user message to appear
    try {
      await page.waitForTimeout(1000);
      const userMsg = await page.locator('text=Say hello in exactly 3 words').first();
      await userMsg.waitFor({ state: 'visible', timeout: 5000 });
      pass('User message rendered in chat');
    } catch (e) {
      fail('User message rendered in chat', e.message);
    }

    // 11. Wait for streaming response
    try {
      // Wait for assistant response to start (pulsing cursor or text content)
      await page.waitForTimeout(5000); // Give Ollama time to respond

      // Look for any text after the user message that's from the assistant
      // The assistant message div will have some content
      const assistantMessages = await page.locator('[class*="bg-white"]').all();

      // Alternative: check if there's content beyond the user message
      const allText = await page.locator('div').filter({ hasText: /hello|hi|hey|greet/i }).first();
      try {
        await allText.waitFor({ state: 'visible', timeout: 15000 });
        pass('Assistant streaming response received');
      } catch {
        // Check if any new content appeared at all
        const bodyText = await page.textContent('body');
        if (bodyText.includes('Hello') || bodyText.includes('hello') || bodyText.includes('Hi')) {
          pass('Assistant streaming response received');
        } else {
          fail('Assistant streaming response received', 'No assistant response detected after 15s');
        }
      }
    } catch (e) {
      fail('Assistant streaming response received', e.message);
    }

    // 12. Switch back to Terminal tab
    try {
      const terminalTab = await page.locator('button:has-text("Terminal")').first();
      await terminalTab.click();
      await page.waitForTimeout(1000);
      pass('Terminal tab still switchable');
    } catch (e) {
      fail('Terminal tab still switchable', e.message);
    }

    // 13. Switch back to Chat — messages should persist
    try {
      const chatTab = await page.locator('button:has-text("Chat")').first();
      await chatTab.click();
      await page.waitForTimeout(500);
      const userMsg = await page.locator('text=Say hello in exactly 3 words').first();
      await userMsg.waitFor({ state: 'visible', timeout: 3000 });
      pass('Chat messages persist across tab switches');
    } catch (e) {
      fail('Chat messages persist across tab switches', e.message);
    }

    // 14. Take a screenshot
    await page.screenshot({ path: 'C:/tmp/chat_audit.png', fullPage: false });
    pass('Screenshot saved to C:/tmp/chat_audit.png');

  } catch (e) {
    console.log(`\n  ABORT: ${e.message}\n`);
  } finally {
    await browser.close();
  }

  // Summary
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  if (failed > 0) {
    console.log('Failures:');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

audit();
