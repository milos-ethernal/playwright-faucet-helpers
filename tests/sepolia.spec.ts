import { test, chromium, Page } from '@playwright/test';
import { mkdir, rm } from 'node:fs/promises';

const walletAddress =
  process.env.WALLET_ADDRESS ?? '0x05Dd8e8554C34c9170f285c81C93b9a130609B0A';

const USE_BRIGHTDATA = true;
const SBR_CDP = process.env.SBR_CDP ?? '';
const IS_CI = !!process.env.CI;

export function recordScreenshots(
  page: Page,
  screenshotsDir: string,
  durationMs = 30000,
  intervalMs = 1000,
) {
  const start = Date.now();
  let i = 0;
  let stopped = false;

  const done = (async () => {
    while (!stopped && Date.now() - start < durationMs) {
      if (page.isClosed()) {
        return;
      }
      try {
        await page.screenshot({
          path: `${screenshotsDir}/frame-${i}.png`,
          fullPage: true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Screenshot ${i} failed: ${message}`);
        return;
      }

      await new Promise((r) => setTimeout(r, intervalMs));
      i++;
    }
  })();

  return {
    stop() {
      stopped = true;
    },
    done,
  };
}

/**
 * Polls every 500ms to check if a CAPTCHA has been solved.
 * Returns true when solved, or throws after a timeout.
 *
 * @param {import('playwright').Page} page
 * @param {number} timeoutMs - Max time to wait (default: 30s)
 */
async function waitForCaptchaSolved(page, timeoutMs = 30000) {
  const interval = 500;
  const maxAttempts = timeoutMs / interval;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const isSolved = await checkCaptchaSolved(page);

    if (isSolved) {
      console.log(`✅ CAPTCHA solved after ${(attempt + 1) * interval}ms`);
      return true;
    }

    console.log(`⏳ Attempt ${attempt + 1}: CAPTCHA not yet solved...`);
    await page.waitForTimeout(interval);
  }

  throw new Error(`❌ CAPTCHA was not solved within ${timeoutMs}ms`);
}

/**
 * Checks the current CAPTCHA state on the page.
 * Adapt the selectors below to match your target site.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function checkCaptchaSolved(page: Page): Promise<boolean> {
  return await page.evaluate((): boolean => {
    // --- Strategy 1: reCAPTCHA v2 (checkbox) ---
    const recaptchaResponse = document.querySelector<HTMLTextAreaElement>(
      'textarea[name="g-recaptcha-response"]'
    );
    if (recaptchaResponse && recaptchaResponse.value.length > 0) {
      return true;
    }

    // --- Strategy 2: hCaptcha ---
    const hcaptchaResponse = document.querySelector<HTMLTextAreaElement>(
      'textarea[name="h-captcha-response"]'
    );
    if (hcaptchaResponse && hcaptchaResponse.value.length > 0) {
      return true;
    }

    // --- Strategy 3: reCAPTCHA visual checkmark ---
    const recaptchaChecked = document.querySelector(".recaptcha-checkbox-checked");
    if (recaptchaChecked) {
      return true;
    }

    return false;
  });
}

async function clickUntilDisabled(page: Page, delayMs = 100, timeoutMs = 120000) {
  const button = page.getByRole('button', { name: '+' });
  const deadline = Date.now() + timeoutMs;

  while (!(await button.isDisabled())) {
    if (page.isClosed()) {
      throw new Error('Page was closed while clicking "+" button.');
    }
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for "+" button to become disabled.');
    }
    await button.click();
    await page.waitForTimeout(delayMs);
  }
}

async function waitAndClickClaimRewards(page: Page, timeoutMs = MAX_DURATION_MS) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new Error('Page was closed while waiting for Claim Rewards.');
    }
    console.log('Waiting for Claim Rewards button to be visible...');
    const button = page.getByRole('button', { name: 'Claim Rewards', exact: true });
    const isVisible = await button.isVisible().catch(() => false);

    if (isVisible) {
      console.log('Claim Rewards button is visible, clicking...');
      await button.click();
      return;
    }

    await page.waitForTimeout(5000);
  }

  throw new Error('Timed out waiting for Claim Rewards button to be visible.');
}

function startKeepAlive(page: Page, intervalMs = 20000) {
  let stopped = false;
  let intervals = 0;

  const loop = (async () => {
    while (!stopped) {
      if (page.isClosed()) return;
      try {
        // Cheap no-op: just evaluates a tiny expression
        await page.evaluate(() => Date.now());

        if (intervals > 15) {
          await page.mouse.move(
            100 + Math.random() * 10,
            100 + Math.random() * 10
          );
        }
        
        intervals++;
        if (intervals % 10 === 0) {
          console.log(`Pinged page ${intervals} times`);
        }
      } catch {
        // ignore — page may be mid-navigation
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();

  return {
    stop() { stopped = true; },
    done: loop,
  };
}

const MAX_DURATION_MS = 3 * 60 * 60 * 1000; // 3 hours

test('test', async ({}, testInfo) => {
  test.setTimeout(MAX_DURATION_MS);

  // Connect instead of launching locally
  if (USE_BRIGHTDATA && !SBR_CDP) {
    throw new Error('Missing SBR_CDP environment variable for Bright Data connection.');
  }

  const browser = USE_BRIGHTDATA
    ? await chromium.connectOverCDP(SBR_CDP)
    : await chromium.launch({
        headless: IS_CI,
        args: IS_CI ? ['--disable-dev-shm-usage'] : undefined,
      });

  console.log(USE_BRIGHTDATA ? 'Connected to BrightData' : 'Launched local Chromium');

  // Use a dedicated isolated context/page for this test run.
  const context = await browser.newContext();
  const page = await context.newPage();

  // Start keepalive immediately after page creation
  const keepAlive = startKeepAlive(page, 20000); // ping every 20s

  browser.on('disconnected', () => {
    console.error('Browser disconnected unexpectedly.');
  });
  context.on('close', () => {
    console.error('Browser context closed.');
  });
  page.on('close', () => {
    console.error('Page closed.');
  });
  page.on('crash', () => {
    console.error('Page crashed.');
  });
  const screenshotsDir = testInfo.outputPath('screenshots');
  await mkdir(screenshotsDir, { recursive: true });

  // start recording (don't await yet if you want parallel)
  const recorder = recordScreenshots(page, screenshotsDir, MAX_DURATION_MS, 5000);

  try {
    await page.goto('https://sepolia-faucet.pk910.de/#/');
    await page.getByRole('textbox', { name: 'Please enter ETH address or' }).click();
    await page.getByRole('textbox', { name: 'Please enter ETH address or' }).fill(walletAddress);
    
    const pollIntervalMs = 2000;
    await page.waitForTimeout(pollIntervalMs);

    try {
      await waitForCaptchaSolved(page, 120000); // wait up to 120 seconds
      console.log("Proceeding past CAPTCHA...");
      // continue with your automation here
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`CAPTCHA step failed: ${message}`);
    }

    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: 'Start Mining' }).click();

    await page.waitForTimeout(5000);

    await clickUntilDisabled(page);

    await waitAndClickClaimRewards(page);
  } finally {
    keepAlive.stop();
    await keepAlive.done.catch(() => {});

    recorder.stop();
    await recorder.done.catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Recorder failed during shutdown: ${message}`);
    });
    await browser.close().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`browser.close() failed: ${message}`);
    });
    console.log('Browser closed');

    if (testInfo.status === testInfo.expectedStatus) {
      await rm(screenshotsDir, { recursive: true, force: true });
    }
  }
});