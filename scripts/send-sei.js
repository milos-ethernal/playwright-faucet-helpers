const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const SEI_TESTNET_RPC = process.env.SEI_TESTNET_RPC || 'https://evm-rpc-testnet.sei-apis.com';
const CHAIN_ID = 1328;
const RECIPIENT = '0x948BcAd7EA8f12Df4C916D8e1CB2567bC73da57c';
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

function requireBigInt(value, fallback = 0n) {
  return typeof value === 'bigint' ? value : fallback;
}

async function sweepSei(sender, provider) {
  const wallet = new ethers.Wallet(sender.privateKey, provider);

  if (wallet.address.toLowerCase() !== sender.address.toLowerCase()) {
    console.warn(`\nSender: ${sender.address}`);
    console.warn(`  SKIP: private key address mismatch (actual ${wallet.address})`);
    return;
  }

  const balance = await provider.getBalance(wallet.address);
  console.log(`\nSender: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} SEI`);

  if (balance === 0n) {
    console.warn('  SKIP: zero balance');
    return;
  }

  const feeData = await provider.getFeeData();
  const maxFeePerGas = requireBigInt(feeData.maxFeePerGas, requireBigInt(feeData.gasPrice));
  const maxPriorityFeePerGas = requireBigInt(feeData.maxPriorityFeePerGas, 0n);
  const gasPrice = requireBigInt(feeData.gasPrice, maxFeePerGas);

  const txBase = { to: RECIPIENT, from: wallet.address, value: 0n, chainId: CHAIN_ID };
  const gasLimit = await wallet.estimateGas(txBase);

  const eip1559Possible = maxFeePerGas > 0n;
  const estimatedGasCost = eip1559Possible ? gasLimit * maxFeePerGas : gasLimit * gasPrice;
  const sendValue = balance - estimatedGasCost;

  if (sendValue <= 0n) {
    console.warn('  SKIP: insufficient balance to cover gas');
    return;
  }

  const txRequest = {
    to: RECIPIENT,
    value: sendValue,
    gasLimit,
    chainId: CHAIN_ID,
  };

  if (eip1559Possible) {
    txRequest.maxFeePerGas = maxFeePerGas;
    txRequest.maxPriorityFeePerGas = maxPriorityFeePerGas;
  } else {
    txRequest.gasPrice = gasPrice;
  }

  console.log(`Send  : ${ethers.formatEther(sendValue)} SEI`);
  const tx = await wallet.sendTransaction(txRequest);
  console.log(`  TX sent: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  Confirmed in block ${receipt.blockNumber}`);
}

async function main() {
  const senders = loadSenders();
  const provider = new ethers.JsonRpcProvider(SEI_TESTNET_RPC, CHAIN_ID);

  console.log(`Recipient : ${RECIPIENT}`);
  console.log(`Network   : Sei Testnet (${CHAIN_ID})`);
  console.log(`RPC       : ${SEI_TESTNET_RPC}`);
  console.log(`Senders   : ${senders.length}`);
  console.log('Mode      : sweep full balance (minus gas)');

  for (const sender of senders) {
    await sweepSei(sender, provider);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
