/**
 * EverClaw X Post Verification Service
 *
 * Verifies that a user has posted their claim code on X.
 * Prevents deletion abuse by storing and re-verifying tweet IDs.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface Tweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
}

interface TwitterApiV2Response {
  data?: Tweet[];
  meta?: {
    result_count: number;
    newest_id?: string;
    oldest_id?: string;
  };
  errors?: Array<{ title: string; detail: string }>;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const X_API_BEARER_TOKEN = process.env.X_API_BEARER_TOKEN;
const MOCK_MODE = process.env.MOCK_X_VERIFICATION === 'true';

// ─── Redis Interface ─────────────────────────────────────────────────────────

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ex?: number }): Promise<void>;
}

let redis: RedisClient;

export function setRedisClient(client: RedisClient) {
  redis = client;
}

// ─── Twitter API Client──────────────────────────────────────────────────────

/**
 * Search for tweets containing the claim code.
 */
async function searchTweets(query: string): Promise<Tweet[]> {
  if (MOCK_MODE) {
    // Return mock tweet for testing
    return [{
      id: 'mock-tweet-id',
      text: `EverClaw claim code: ${query}wallet: 0xMock`,
      created_at: new Date().toISOString()
    }];
  }

  if (!X_API_BEARER_TOKEN) {
    throw new Error('X_API_BEARER_TOKEN environment variable required');
  }

  const url = new URL('https://api.twitter.com/2/tweets/search/recent');
  url.searchParams.set('query', `"${query}"`);
  url.searchParams.set('max_results', '10');
  url.searchParams.set('tweet.fields', 'author_id,created_at');

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${X_API_BEARER_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`X API error: ${response.status} - ${error}`);
  }

  const data: TwitterApiV2Response = await response.json();
  return data.data || [];
}

/**
 * Verify a tweet still exists (anti-deletion check).
 */
async function verifyTweetExists(tweetId: string): Promise<boolean> {
  if (MOCK_MODE) {
    return true;
  }

  if (!X_API_BEARER_TOKEN) {
    throw new Error('X_API_BEARER_TOKEN environment variable required');
  }

  const url = `https://api.twitter.com/2/tweets/${tweetId}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${X_API_BEARER_TOKEN}`
    }
  });

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error(`X API error: ${response.status}`);
  }

  return true;
}

// ─── Verification Function ───────────────────────────────────────────────────

/**
 * Verify X post with claim code.
 * 
 * Steps:
 * 1. Search for tweets containing the claim code
 * 2. Check if wallet address is in the tweet text
 * 3. Check if claim code was already used
 * 4. Verify tweet still exists (not deleted)
 * 5. Store tweet ID for future checks
 * 
 * @param claimCode - The EVER-XXXX-YYYY claim code
 * @param wallet - User's wallet address
 * @returns Tweet ID if verified
 */
export async function verifyXPost(
  claimCode: string,
  wallet: string
): Promise<{ tweetId: string; verified: true }> {
  if (!redis) {
    throw new Error('Redis client not initialized. Call setRedisClient() first.');
  }

  // Check if claim code already used
  const existingTweetId = await redis.get(`claim:${claimCode}`);
  if (existingTweetId) {
    throw new Error('CLAIM_CODE_ALREADY_USED');
  }

  // Search for tweets
  const tweets = await searchTweets(claimCode);
  if (tweets.length === 0) {
    throw new Error('TWEET_NOT_FOUND');
  }

  // Find tweet that contains the wallet address
  const walletLower = wallet.toLowerCase();
  const matchingTweet = tweets.find(t => t.text.toLowerCase().includes(walletLower));
  if (!matchingTweet) {
    throw new Error('WALLET_MISMATCH');
  }

  // Verify tweet still exists
  const exists = await verifyTweetExists(matchingTweet.id);
  if (!exists) {
    throw new Error('TWEET_DELETED');
  }

  // Store for future verification
  await redis.set(`claim:${claimCode}`, matchingTweet.id);
  await redis.set(`tweet:${matchingTweet.id}`, JSON.stringify({
    wallet,
    claimCode,
    verifiedAt: Date.now()
  }));

  return { tweetId: matchingTweet.id, verified: true };
}

/**
 * Re-verify a previously verified tweet (check it wasn't deleted).
 */
export async function reverifyTweet(tweetId: string): Promise<boolean> {
  return verifyTweetExists(tweetId);
}