#!/usr/bin/env node
/**
 * Test Upstash Redis Connection
 */

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function main() {
  console.log('Testing Upstash Redis connection...\n');

  // Test SET
  console.log('1. SET test_bootstrap_key = "hello_everclaw"');
  const setResult = await redis.set('test_bootstrap_key', 'hello_everclaw');
  console.log(`   Result: ${setResult}\n`);

  // Test GET
  console.log('2. GET test_bootstrap_key');
  const getValue = await redis.get('test_bootstrap_key');
  console.log(`   Result: ${getValue}\n`);

  // Test INCR
  console.log('3. INCR test_counter');
  const incrResult = await redis.incr('test_counter');
  console.log(`   Result: ${incrResult}\n`);

  // Test EXPIRE
  console.log('4. EXPIRE test_counter 60');
  const expireResult = await redis.expire('test_counter', 60);
  console.log(`   Result: ${expireResult}\n`);

  // Test DEL
  console.log('5. DEL test_bootstrap_key');
  const delResult = await redis.del('test_bootstrap_key');
  console.log(`   Result: ${delResult}\n`);

  // Test Lua script (atomic increment with limit)
  console.log('6. Lua script: atomic increment with limit');
  const luaScript = `
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
  
  const luaResult = await redis.eval(luaScript, ['test_daily_limit'], ['10', '1']);
  console.log(`   First call (should succeed): ${luaResult}`);
  
  const luaResult2 = await redis.eval(luaScript, ['test_daily_limit'], ['10', '15']);
  console.log(`   Second call (should fail): ${luaResult2}\n`);

  console.log('✅ All Upstash Redis tests passed!');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});