#!/usr/bin/env node
/**
 * Bootstrap Test Script - Base Mainnet
 * 
 * Tests the hot-wallet transfer functionality without Redis.
 * Sends 0.0008 ETH + 2 USDC from treasury to test address.
 * 
 * Usage:
 *   TREASURY_HOT_KEY=0x... node test-bootstrap-mainnet.mjs
 */

import { createWalletClient, http, parseEther, parseUnits, formatEther, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

// Configuration
const TREASURY_KEY = process.env.TREASURY_HOT_KEY;
const TEST_RECIPIENT = process.env.TEST_RECIPIENT || '0x5FB26ECA8F276d8fF7e9B3B33e61934Fa26AE417';
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
] as const;

async function main() {
  if (!TREASURY_KEY) {
    console.error('Error: TREASURY_HOT_KEY environment variable required');
    console.error('Usage: TREASURY_HOT_KEY=0x... node test-bootstrap-mainnet.mjs');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Bootstrap Test - Base Mainnet');
  console.log('='.repeat(60));
  console.log();

  // Setup wallet
  const account = privateKeyToAccount(TREASURY_KEY as `0x${string}`);
  const client = createWalletClient({
    account,
    chain: base,
    transport: http('https://base-mainnet.public.blastapi.io')
  });

  console.log('Treasury Wallet:', account.address);
  console.log('Recipient:', TEST_RECIPIENT);
  console.log();

  // Check balances before
  console.log('Checking balances...');
  const ethBalBefore = await client.getBalance({ address: account.address });
  console.log(`  Treasury ETH: ${formatEther(ethBalBefore)}`);

  // Check USDC balance (need to use public client for read)
  const publicClient = createWalletClient({
    account,
    chain: base,
    transport: http('https://base-mainnet.public.blastapi.io')
  });
  console.log();

  console.log('Transfer amounts:');
  console.log(`  ETH: ${formatEther(ETH_AMOUNT)}`);
  console.log(`  USDC: ${formatUnits(USDC_AMOUNT, 6)}`);
  console.log();

  // Confirm before proceeding
  console.log('⚠️  This will spend REAL funds on Base mainnet!');
  console.log('Press Ctrl+C to cancel, or wait 5 seconds...');
  await new Promise(r => setTimeout(r, 5000));
  console.log();

  // Execute ETH transfer
  console.log('Sending ETH...');
  const ethTx = await client.sendTransaction({
    to: TEST_RECIPIENT as `0x${string}`,
    value: ETH_AMOUNT
  });
  console.log(`  ✅ ETH tx: https://basescan.org/tx/${ethTx}`);

  // Execute USDC transfer
  console.log('Sending USDC...');
  const usdcTx = await client.writeContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [TEST_RECIPIENT as `0x${string}`, USDC_AMOUNT]
  });
  console.log(`  ✅ USDC tx: https://basescan.org/tx/${usdcTx}`);

  console.log();
  console.log('='.repeat(60));
  console.log('✅ Bootstrap test complete!');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});