import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const APP_URL = 'http://localhost:5173/';
const OUTPUT_PATH = 'C:/Users/User/.gemini/antigravity/brain/69931657-ad68-4407-bb7a-d254842c944b/alien_dermis_cube.png';

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist']
  });

  try {
    console.log('1. Loading page with clean storage...');
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    
    await page.addInitScript(() => {
      window.localStorage.clear();
    });

    await page.goto(APP_URL, { waitUntil: 'networkidle' });

    console.log('2. Selecting Cube object...');
    await page.click('[data-object="cube"]');
    await delay(300);

    console.log('3. Selecting Alien Dermis preset...');
    await page.click('[data-preset="alien-dermis"]');
    await delay(400);

    console.log('4. Selecting Cells layer...');
    await page.click('article[data-layer-index="1"] button[data-action="select"]');
    await delay(300);

    console.log('5. Manually setting Cells -> Displace = 0.016...');
    const displaceInput = page.locator('input[data-field="displacement"][data-peer="number"]');
    await displaceInput.fill('0.016');
    await displaceInput.dispatchEvent('input');
    await displaceInput.dispatchEvent('change');
    await delay(300);

    // Verify what the input and slider values are
    const numVal = await displaceInput.inputValue();
    const rangeVal = await page.locator('input[data-field="displacement"][data-peer="range"]').inputValue();
    console.log(`Displace inputs in Inspector: number = ${numVal}, range = ${rangeVal}`);

    console.log('6. Rotating the object...');
    const canvas = page.locator('canvas.lab-canvas');
    const box = await canvas.boundingBox();
    if (box) {
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      for (let i = 0; i < 3; i++) {
        await page.mouse.move(centerX, centerY);
        await page.mouse.down();
        await page.mouse.move(centerX + 80, centerY - 40, { steps: 8 });
        await page.mouse.up();
        await delay(200);
      }
    }

    console.log('7. Watching FPS counter...');
    for (let sample = 1; sample <= 3; sample++) {
      await delay(800);
      const perf = await page.locator('[data-role="performance"]').textContent();
      console.log(`FPS Sample ${sample}: ${perf}`);
    }

    console.log('8. Capturing final screenshot...');
    await page.screenshot({ path: OUTPUT_PATH, fullPage: true });
    console.log('SCREENSHOT_DONE: ' + OUTPUT_PATH);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exitCode = 1;
});
