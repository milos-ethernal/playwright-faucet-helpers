import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const walletAddresses = fs
  .readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /^0x[a-fA-F0-9]{40}\s*:/.test(line))
  .map((line) => line.split(':')[0].trim());

test('test', async ({ page }) => {
  test.setTimeout(1000 * 3000)

  // 1. Go to the faucet page
  await page.goto('https://faucet.stakepool.dev.br/amoy');

  const walletInput = page.getByRole('textbox', { name: '0x....' });
  const getTokensButton = page.getByRole('button', { name: 'Get Tokens' });

  for (const walletAddress of walletAddresses) {
    // 2. Fill in the wallet address
    await walletInput.click();
    await walletInput.fill(walletAddress);

    // In a loop wait for the button to be enabled and click it
    while (!(await getTokensButton.isVisible()) && !(await getTokensButton.isEnabled())) {
      await page.waitForTimeout(1000);
    }

    await getTokensButton.click();

    await page.waitForTimeout(1000);
  }
});