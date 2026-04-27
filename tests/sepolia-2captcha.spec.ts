import { test, chromium, Page } from '@playwright/test';
import { mkdir, rm } from 'node:fs/promises';

const walletAddress =
  process.env.WALLET_ADDRESS ?? '0x05Dd8e8554C34c9170f285c81C93b9a130609B0A';
  
const SEPOLIA_FAUCET_SITEKEY = '6Leg_psiAAAAAHlE_PSnJuYLQDXbrnBw6G2l_vvu';

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

import { Solver } from '@2captcha/captcha-solver';

const solver = new Solver(process.env.TWOCAPTCHA_API_KEY!);

async function solveCaptchaViaAPI(page: Page): Promise<void> {
  // Extract sitekey from the reCAPTCHA iframe URL
  const sitekey = await page.waitForFunction(() => {
    const frames = Array.from(document.querySelectorAll('iframe'));
    for (const frame of frames) {
      const src = frame.src || '';
      if (src.includes('recaptcha') || src.includes('hcaptcha')) {
        const match = src.match(/[?&]k=([^&]+)/);
        if (match) return match[1];
      }
    }
    return null;
  }, { timeout: 15000 }).then(h => h.jsonValue());

  if (!sitekey) throw new Error('Could not extract sitekey from recaptcha iframe');
  console.log(`Sitekey: ${sitekey}`);

  // Submit to 2Captcha
  const result = await solver.recaptcha({
    pageurl: 'https://sepolia-faucet.pk910.de/',
    googlekey: sitekey,
  });

  console.log('Token received, injecting...');

  // Inject token and fire the callback
  await page.evaluate((token) => {
    // Set the hidden textarea value
    const textarea = document.querySelector<HTMLTextAreaElement>('#g-recaptcha-response');
    if (textarea) {
      textarea.style.display = 'block';
      textarea.value = token;
    }

    // Find and call the reCAPTCHA callback
    const w = window as any;
    if (w.grecaptcha?.getResponse) {
      // Try to find callback from grecaptcha internals
      try {
        const clients = w.___grecaptcha_cfg?.clients;
        if (clients) {
          for (const key of Object.keys(clients)) {
            const client = clients[key];
            for (const prop of Object.keys(client)) {
              if (client[prop]?.callback) {
                client[prop].callback(token);
                return;
              }
            }
          }
        }
      } catch (e) {
        console.error('Callback fire failed:', e);
      }
    }
  }, result.data);

  console.log('reCAPTCHA token injected');
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
  const TWOCAPTCHA_API_KEY = process.env.TWOCAPTCHA_API_KEY;
  if (!TWOCAPTCHA_API_KEY || TWOCAPTCHA_API_KEY.length !== 32) {
    throw new Error(`Invalid TWOCAPTCHA_API_KEY: "${TWOCAPTCHA_API_KEY}" (length: ${TWOCAPTCHA_API_KEY?.length})`);
  }

  test.setTimeout(MAX_DURATION_MS);

  // Connect instead of launching locally
  const browser = await chromium.launch({
    headless: IS_CI,
    args: IS_CI ? ['--disable-dev-shm-usage'] : undefined,
  });

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
      await solveCaptchaViaAPI(page);
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