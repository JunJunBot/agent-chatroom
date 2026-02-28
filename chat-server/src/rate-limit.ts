export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryAfter?: number;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export class GlobalRateLimiter {
  private static instance: GlobalRateLimiter;
  private agentMessageTimestamps: number[] = [];
  private tokenBuckets: Map<string, TokenBucket> = new Map();
  private readonly MAX_AGENT_MESSAGES_PER_MINUTE = 15;
  private readonly MAX_AGENTS = 100;
  private readonly BUCKET_CAPACITY = 5;
  private readonly REFILL_RATE = 1; // tokens per second

  private constructor() {}

  static getInstance(): GlobalRateLimiter {
    if (!GlobalRateLimiter.instance) {
      GlobalRateLimiter.instance = new GlobalRateLimiter();
    }
    return GlobalRateLimiter.instance;
  }

  checkRateLimit(sender: string, senderType: string, allMessages: any[]): RateLimitResult {
    // Humans always allowed
    if (senderType === 'human') {
      return { allowed: true };
    }

    const now = Date.now();

    // Check 1: Global sliding window (15 agent messages per minute)
    this.agentMessageTimestamps = this.agentMessageTimestamps.filter(
      ts => now - ts < 60000
    );

    if (this.agentMessageTimestamps.length >= this.MAX_AGENT_MESSAGES_PER_MINUTE) {
      const oldestTimestamp = this.agentMessageTimestamps[0];
      const retryAfter = 60000 - (now - oldestTimestamp);
      return {
        allowed: false,
        reason: 'Global agent rate limit exceeded (15/min)',
        retryAfter
      };
    }

    // Check 2: Per-agent token bucket
    const bucketCheck = this.checkTokenBucket(sender);
    if (!bucketCheck.allowed) {
      return bucketCheck;
    }

    // Check 3: Agent ratio (max 70% agent messages in last 60s)
    const sixtySecondsAgo = now - 60000;
    const recentMessages = allMessages.filter(m => m.timestamp > sixtySecondsAgo);
    const agentMessagesCount = recentMessages.filter(m => m.senderType === 'agent').length;
    const totalMessagesCount = recentMessages.length;

    if (totalMessagesCount > 0) {
      const agentRatio = agentMessagesCount / totalMessagesCount;
      if (agentRatio > 0.7) {
        return {
          allowed: false,
          reason: 'Agent message ratio too high (max 70%)',
          retryAfter: 5000
        };
      }
    }

    // All checks passed - record message and consume token
    this.agentMessageTimestamps.push(now);
    this.consumeToken(sender);

    return { allowed: true };
  }

  // No hard agent limit - inactive agents are cleaned up instead
  checkAgentLimit(_currentAgentCount: number): boolean {
    return true;
  }

  // Reset state (for testing)
  reset(): void {
    this.agentMessageTimestamps = [];
    this.tokenBuckets = new Map();
  }

  private checkTokenBucket(sender: string): RateLimitResult {
    const now = Date.now();
    let bucket = this.tokenBuckets.get(sender);

    if (!bucket) {
      bucket = {
        tokens: this.BUCKET_CAPACITY,
        lastRefill: now
      };
      this.tokenBuckets.set(sender, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    const tokensToAdd = elapsedSeconds * this.REFILL_RATE;
    bucket.tokens = Math.min(this.BUCKET_CAPACITY, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    // Check if token available
    if (bucket.tokens < 1) {
      const retryAfter = Math.ceil((1 - bucket.tokens) / this.REFILL_RATE * 1000);
      return {
        allowed: false,
        reason: 'Per-agent rate limit exceeded',
        retryAfter
      };
    }

    return { allowed: true };
  }

  private consumeToken(sender: string): void {
    const bucket = this.tokenBuckets.get(sender);
    if (bucket && bucket.tokens >= 1) {
      bucket.tokens -= 1;
    }
  }
}

export const globalRateLimiter = GlobalRateLimiter.getInstance();
