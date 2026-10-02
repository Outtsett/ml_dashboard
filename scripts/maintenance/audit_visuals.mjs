/**
 * Playwright visual audit — screenshot training tabs and bottom panel.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5000';

async function audit() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  console.log('\n=== Visual Audit ===\n');

  // Market Data page (default)
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'C:/tmp/visual_market_data.png', fullPage: false });
  console.log('  1. Market Data page screenshot saved');

  // Click Chat tab in bottom panel
  try {
    const chatTab = await page.locator('button:has-text("Chat")').first();
    await chatTab.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'C:/tmp/visual_chat_tab.png', fullPage: false });
    console.log('  2. Chat tab screenshot saved');
  } catch (e) {
    console.log('  2. Chat tab: ' + e.message);
  }

  // Navigate to ML Studio / Training
  await page.goto(BASE + '/ml-studio', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'C:/tmp/visual_ml_studio.png', fullPage: false });
  console.log('  3. ML Studio page screenshot saved');

  // Navigate to Training page
  await page.goto(BASE + '/ml-studio', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Try clicking Overview tab
  try {
    const overviewTab = await page.locator('button:has-text("Overview")').first();
    await overviewTab.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'C:/tmp/visual_overview_tab.png', fullPage: false });
    console.log('  4. Overview tab screenshot saved');
  } catch (e) {
    console.log('  4. Overview tab: ' + e.message);
  }

  // Model State tab
  try {
    const modelStateTab = await page.locator('button:has-text("Model State")').first();
    await modelStateTab.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'C:/tmp/visual_model_state.png', fullPage: false });
    console.log('  5. Model State tab screenshot saved');
  } catch (e) {
    console.log('  5. Model State tab: ' + e.message);
  }

  // Performance tab
  try {
    const perfTab = await page.locator('button:has-text("Performance")').first();
    await perfTab.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'C:/tmp/visual_performance_tab.png', fullPage: false });
    console.log('  6. Performance tab screenshot saved');
  } catch (e) {
    console.log('  6. Performance tab: ' + e.message);
  }

  // Model Catalog
  await page.goto(BASE + '/model-catalog', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'C:/tmp/visual_model_catalog.png', fullPage: false });
  console.log('  7. Model Catalog screenshot saved');

  await browser.close();
  console.log('\n=== All screenshots saved to C:/tmp/ ===\n');
}

audit().catch(e => { console.error(e); process.exit(1); });
