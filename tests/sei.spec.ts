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

  for (const walletAddress of walletAddresses) {
    await page.goto('https://docs.sei.io/learn/faucet');
 
    await page.getByText('Enter your wallet address').click();
    await page.getByRole('textbox', { name: 'Enter your EVM (0x...) address' }).click();
    await page.getByRole('textbox', { name: 'Enter your EVM (0x...) address' }).fill(walletAddress);
    await page.getByRole('button', { name: 'Verify Captcha' }).click();

    // In a loop wait for the button to be enabled and click it
    while (!(await page.getByRole('button', { name: 'Request SEI' }).isEnabled())) {
      await page.waitForTimeout(10000);
    }

    await page.getByRole('button', { name: 'Request SEI' }).click();

    await page.waitForTimeout(5000);
  }

 
});