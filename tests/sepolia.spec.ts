import { test, chromium, Page } from '@playwright/test';
import { mkdir, rm } from 'node:fs/promises';

const walletAddress =
  process.env.WALLET_ADDRESS ?? '0x05Dd8e8554C34c9170f285c81C93b9a130609B0A';

const USE_BRIGHTDATA = true;
const SBR_CDP = process.env.SBR_CDP ?? '';

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
      await page.screenshot({
        path: `${screenshotsDir}/frame-${i}.png`,
        fullPage: true
      });

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

async function clickUntilDisabled(page: Page, delayMs = 100) {
  const button = page.getByRole('button', { name: '+' });

  while (!(await button.isDisabled())) {
    await button.click();
    await page.waitForTimeout(delayMs);
  }
}

async function waitAndClickClaimRewards(page: Page) {
  while (true) {
    console.log('Waiting for Claim Rewards button to be visible...');
    const button = page.getByRole('button', { name: 'Claim Rewards', exact: true });
    const isVisible = await button.isVisible().catch(() => false);

    if (isVisible) {
      console.log('Claim Rewards button is visible, clicking...');
      await button.click();
      break;
    }

    await page.waitForTimeout(5000);
  }
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
    : await chromium.launch({ headless: false });

  console.log('Connected to BrightData');

  const context = browser.contexts()[0] || await browser.newContext();
  const page = context.pages()[0] || await context.newPage();
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
      console.error(err.message);
    }

    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: 'Start Mining' }).click();

    await page.waitForTimeout(5000);

    await clickUntilDisabled(page);

    await waitAndClickClaimRewards(page);
  } finally {
    recorder.stop();
    await recorder.done;
    await browser.close();
    console.log('Browser closed');

    if (testInfo.status === testInfo.expectedStatus) {
      await rm(screenshotsDir, { recursive: true, force: true });
    }
  }
});