#!/usr/bin/env node
/**
 * Bootstrap Transfer Test - Base Mainnet
 * 
 * Tests sending 0.0008 ETH + 2 USDC to a recipient.
 * 
 * ⚠️ This spends REAL funds on Base mainnet!
 * 
 * Usage:
 *   TREASURY_HOT_KEY=0x... node test-transfer.mjs
 */

import { createWalletClient, createPublicClient, http, parseEther, parseUnits, formatEther, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { randomBytes } from 'crypto';

// Configuration
const TREASURY_KEY = process.env.TREASURY_HOT_KEY;
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base mainnet

const ETH_AMOUNT = parseEther('0.0008');
const USDC_AMOUNT = parseUnits('2.00', 6);

// Minimal ERC-20 ABI
const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
];

async function main() {
  if (!TREASURY_KEY) {
    console.error('Error: TREASURY_HOT_KEY environment variable required');
    console.error('');
    console.error('Usage:');
    console.error('  TREASURY_HOT_KEY=0x... node test-transfer.mjs');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Bootstrap Transfer Test - Base Mainnet');
  console.log('='.repeat(60));
  console.log();

  // Setup treasury wallet
  const treasury = privateKeyToAccount(TREASURY_KEY);
  const client = createWalletClient({
    account: treasury,
    chain: base,
    transport: http('https://base-mainnet.public.blastapi.io')
  });

  const publicClient = createPublicClient({
    chain: base,
    transport: http('https://base-mainnet.public.blastapi.io')
  });

  // Generate test recipient (simulates user wallet)
  const testRecipientKey = '0x' + randomBytes(32).toString('hex');
  const testRecipient = privateKeyToAccount(testRecipientKey);

  console.log('Wallet Addresses:');
  console.log(`  Treasury: ${treasury.address}`);
  console.log(`  Test Recipient: ${testRecipient.address}`);
  console.log();

  // Check treasury balances
  console.log('Treasury Balances:');
  const ethBalance = await publicClient.getBalance({ address: treasury.address });
  console.log(`  ETH: ${formatEther(ethBalance)}`);

  const usdcBalance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [treasury.address]
  });
  console.log(`  USDC: ${formatUnits(usdcBalance, 6)}`);
  console.log();

  console.log('Transfer Amounts:');
  console.log(`  ETH: ${formatEther(ETH_AMOUNT)}`);
  console.log(`  USDC: ${formatUnits(USDC_AMOUNT, 6)}`);
  console.log();

  // Check if we have enough
  if (ethBalance < ETH_AMOUNT) {
    console.error('Insufficient ETH balance');
    process.exit(1);
  }
  if (usdcBalance < USDC_AMOUNT) {
    console.error('Insufficient USDC balance');
    process.exit(1);
  }

  console.log('WARNING: This will spend REAL funds on Base mainnet!');
  console.log('Estimated cost: ~$3 (0.0008 ETH + 2 USDC + gas)');
  console.log();
  console.log('Proceeding in 3 seconds...');
  await new Promise(r => setTimeout(r, 3000));

  console.log();
  console.log('Executing transfers...');
  console.log();

  // Execute ETH transfer
  console.log('1. Sending ETH...');
  const ethTxHash = await client.sendTransaction({
    to: testRecipient.address,
    value: ETH_AMOUNT
  });
  console.log(`   ETH tx: https://basescan.org/tx/${ethTxHash}`);

  // Execute USDC transfer
  console.log('2. Sending USDC...');
  const usdcTxHash = await client.writeContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [testRecipient.address, USDC_AMOUNT]
  });
  console.log(`   USDC tx: https://basescan.org/tx/${usdcTxHash}`);

  console.log();
  console.log('='.repeat(60));
  console.log('Transfer test complete!');
  console.log('='.repeat(60));
  console.log();
  console.log('Test recipient wallet:');
  console.log(`  Address: ${testRecipient.address}`);
  console.log(`  Private Key: ${testRecipientKey}`);
  console.log();
  console.log('View transactions:');
  console.log(`  ETH: https://basescan.org/tx/${ethTxHash}`);
  console.log(`  USDC: https://basescan.org/tx/${usdcTxHash}`);
}

main().catch(err => {
  console.error('');
  console.error('Error:', err.message);
  process.exit(1);
});