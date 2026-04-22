/**
 * EverClaw Bootstrap Hot Wallet Transfer Service
 *
 * Handles ETH and USDC transfers from a hot wallet with daily limits.
 * Uses atomic Redis Lua scripts for rate limiting.
 *
 * Features:
 * - Chain switching (Base mainnet / Base Sepolia for testing)
 * - Configurable daily limits
 * - Partial failure logging for retry
 */

import { createWalletClient, http, parseEther, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

// ERC-20 transfer ABI (minimal)
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
  }
] as const;

// ─── Configuration ──────────────────────────────────────────────────────────

// Chain switching (GAP-001)
const chain = process.env.NODE_ENV === 'test' ? baseSepolia : base;

// USDC address per network (GAP-004)
const USDC_CONTRACT = process.env.NODE_ENV === 'test'
  ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // Base Sepolia USDC
  : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base mainnet USDC

// Configurable limits (GAP-002)
const ETH_LIMIT = process.env.TEST_DAILY_ETH_LIMIT
  ? parseEther(process.env.TEST_DAILY_ETH_LIMIT)
  : parseEther('10');

const USDC_LIMIT = process.env.TEST_DAILY_USDC_LIMIT
  ? parseUnits(process.env.TEST_DAILY_USDC_LIMIT, 6)
  : parseUnits('5000', 6);

// Hot wallet
const HOT_KEY = process.env.TREASURY_HOT_KEY;
if (!HOT_KEY) {
  throw new Error('TREASURY_HOT_KEY environment variable required');
}

// ─── Clients ────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(HOT_KEY as `0x${string}`);
const client = createWalletClient({
  account,
  chain,
  transport: http(process.env.BASE_RPC_URL || 'https://base-mainnet.public.blastapi.io')
});

// ─── Redis (simple client) ───────────────────────────────────────────────────

// Note: In production, use a proper Redis client like 'redis' or 'ioredis'
// This is a placeholder that shows the interface

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ex?: number }): Promise<void>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<number>;
}

let redis: RedisClient;

export function setRedisClient(client: RedisClient) {
  redis = client;
}

// ─── Atomic Daily Limit Lua Script ───────────────────────────────────────────

const LIMIT_LUA = `
  local key = KEYS[1]
  local limit = tonumber(ARGV[1])
  local amount = tonumber(ARGV[2])
  local current = tonumber(redis.call('GET', key) or '0')
  if current + amount > limit then
    return 0
  else
    redis.call('INCRBY', key, amount)
    redis.call('EXPIRE', key, 86400)
    return 1
  end
`;

// ─── Transfer Function──────────────────────────────────────────────────────

/**
 * Execute ETH and USDC transfers from hot wallet.
 * 
 * @param to- Recipient address
 * @param options - Optional USDC bonus amount
 * @returns Transaction hashes
 */
export async function executeTransfers(
  to: `0x${string}`,
  options: { usdcBonus?: string } = {}
): Promise<{ ethTx: `0x${string}`; usdcTx: `0x${string}` }> {
  if (!redis) {
    throw new Error('Redis client not initialized. Call setRedisClient() first.');
  }

  const today = new Date().toISOString().slice(0, 10);
  const ethKey = `bootstrap:daily:eth:${today}`;
  const usdcKey = `bootstrap:daily:usdc:${today}`;

  const ethAmount = parseEther('0.0008');
  const usdcAmount = options.usdcBonus
    ? parseUnits(options.usdcBonus, 6)
    : parseUnits('2.00', 6);

  // Atomic limit check using Lua script
  const ethApproved = await redis.eval(LIMIT_LUA, {
    keys: [ethKey],
    arguments: [ETH_LIMIT.toString(), ethAmount.toString()]
  });

  const usdcApproved = await redis.eval(LIMIT_LUA, {
    keys: [usdcKey],
    arguments: [USDC_LIMIT.toString(), usdcAmount.toString()]
  });

  if (!ethApproved) {
    throw new Error('DAILY_ETH_LIMIT_REACHED');
  }
  if (!usdcApproved) {
    throw new Error('DAILY_USDC_LIMIT_REACHED');
  }

  // ETH transfer
  const ethTx = await client.sendTransaction({
    to,
    value: ethAmount
  });

  // USDC transfer with partial failure logging
  let usdcTx: `0x${string}`;
  try {
    usdcTx = await client.writeContract({
      address: USDC_CONTRACT,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [to, usdcAmount]
    });
  } catch (error) {
    // Log partial failure for manual retry
    await redis.set(`bootstrap:failed:${to}`, JSON.stringify({
      ethTx,
      usdcAmount: usdcAmount.toString(),
      error: (error as Error).message,
      timestamp: Date.now()
    }));
    throw new Error(`ETH sent but USDC failed. ETH tx: ${ethTx}. Logged for retry.`);
  }

  return { ethTx, usdcTx };
}

// ─── Exports───────────────────────────────────────────────────────────────

export const getChainName = () => chain.name;
export const getUsdcAddress = () => USDC_CONTRACT;
export const getEthLimit = () => ETH_LIMIT.toString();
export const getUsdcLimit = () => USDC_LIMIT.toString();