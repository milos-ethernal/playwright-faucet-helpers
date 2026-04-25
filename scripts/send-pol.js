const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const AMOY_RPC = 'https://rpc-amoy.polygon.technology';
const CHAIN_ID = 80002;
const RECIPIENT = '0x948BcAd7EA8f12Df4C916D8e1CB2567bC73da57c';
const AMOUNT = ethers.parseEther('1');
const ENV_FILE = path.join(__dirname, '..', '.env');

function loadSenders() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error(`ERROR: .env not found at ${ENV_FILE}`);
    console.error('Add one "address:privateKey" pair per line.');
    process.exit(1);
  }

  return fs
    .readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^0x[a-fA-F0-9]{40}\s*:/.test(line))
    .map((line, i) => {
      const [address, privateKey] = line.split(':');
      if (!address || !privateKey) {
        console.error(`ERROR: Invalid format on line ${i + 1}: "${line}"`);
        console.error('Expected format: 0xAddress:0xPrivateKey');
        process.exit(1);
      }
      return { address: address.trim(), privateKey: privateKey.trim() };
    });
}

async function sendPol(sender, provider) {
  const wallet = new ethers.Wallet(sender.privateKey, provider);
  const balance = await provider.getBalance(wallet.address);

  console.log(`\nSender: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} POL`);

  if (balance < AMOUNT) {
    console.warn(`  SKIP: insufficient balance (need 1 POL + gas)`);
    return;
  }

  const feeData = await provider.getFeeData();
  const tx = await wallet.sendTransaction({
    to: RECIPIENT,
    value: AMOUNT,
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    chainId: CHAIN_ID,
  });

  console.log(`  TX sent: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  Confirmed in block ${receipt.blockNumber}`);
}

async function main() {
  const senders = loadSenders();
  const provider = new ethers.JsonRpcProvider(AMOY_RPC, CHAIN_ID);

  console.log(`Recipient : ${RECIPIENT}`);
  console.log(`Amount    : 1 POL`);
  console.log(`Network   : Polygon Amoy (${CHAIN_ID})`);
  console.log(`Senders   : ${senders.length}`);

  for (const sender of senders) {
    await sendPol(sender, provider);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
