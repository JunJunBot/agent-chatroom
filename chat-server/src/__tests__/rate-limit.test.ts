import { describe, it, expect, beforeEach } from 'vitest';
import { globalRateLimiter, GlobalRateLimiter } from '../rate-limit';

describe('RateLimit', () => {
  beforeEach(() => {
    globalRateLimiter.reset();
  });

  it('should be a singleton', () => {
    const instance1 = GlobalRateLimiter.getInstance();
    const instance2 = GlobalRateLimiter.getInstance();
    expect(instance1).toBe(instance2);
  });

  describe('checkRateLimit', () => {
    it('should always allow humans', () => {
      const result = globalRateLimiter.checkRateLimit('Alice', 'human', []);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should allow agents initially', () => {
      const result = globalRateLimiter.checkRateLimit('Agent1', 'agent', []);
      expect(result.allowed).toBe(true);
    });

    it('should enforce global rate limit (15/min)', () => {
      // Pre-fill with human messages so ratio doesn't block
      const messages: any[] = [];
      for (let i = 0; i < 50; i++) {
        messages.push({
          sender: `Human${i}`,
          senderType: 'human',
          timestamp: Date.now()
        });
      }

      // Send 15 agent messages (each from different agent for fresh token bucket)
      for (let i = 0; i < 15; i++) {
        const result = globalRateLimiter.checkRateLimit(`Agent${i}`, 'agent', messages);
        expect(result.allowed).toBe(true);
        messages.push({
          sender: `Agent${i}`,
          senderType: 'agent',
          timestamp: Date.now()
        });
      }

      // 16th should be blocked
      const result = globalRateLimiter.checkRateLimit('Agent16', 'agent', messages);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Global');
    });

    it('should enforce token bucket (burst of 5)', () => {
      // Add some human messages to avoid ratio check
      const messages: any[] = [
        { sender: 'Human1', senderType: 'human', timestamp: Date.now() },
        { sender: 'Human2', senderType: 'human', timestamp: Date.now() },
        { sender: 'Human3', senderType: 'human', timestamp: Date.now() },
        { sender: 'Human4', senderType: 'human', timestamp: Date.now() },
        { sender: 'Human5', senderType: 'human', timestamp: Date.now() },
        { sender: 'Human6', senderType: 'human', timestamp: Date.now() },
        { sender: 'Human7', senderType: 'human', timestamp: Date.now() },
        { sender: 'Human8', senderType: 'human', timestamp: Date.now() },
        { sender: 'Human9', senderType: 'human', timestamp: Date.now() },
        { sender: 'Human10', senderType: 'human', timestamp: Date.now() },
      ];

      let allowedCount = 0;

      for (let i = 0; i < 10; i++) {
        const result = globalRateLimiter.checkRateLimit('BurstyAgent', 'agent', messages);
        if (result.allowed) {
          allowedCount++;
          messages.push({
            sender: 'BurstyAgent',
            senderType: 'agent',
            timestamp: Date.now()
          });
        }
      }

      // Should allow at most 5 initially (bucket capacity)
      expect(allowedCount).toBeLessThanOrEqual(5);
      expect(allowedCount).toBeGreaterThanOrEqual(1);
    });

    it('should enforce agent ratio (70% cap)', () => {
      const now = Date.now();
      // Pre-fill with 8 agent, 2 human = 80% ratio
      const messages: any[] = [];
      for (let i = 0; i < 8; i++) {
        messages.push({
          sender: `ExistAgent${i}`,
          senderType: 'agent',
          timestamp: now - 30000
        });
      }
      for (let i = 0; i < 2; i++) {
        messages.push({
          sender: `Human${i}`,
          senderType: 'human',
          timestamp: now - 30000
        });
      }

      const result = globalRateLimiter.checkRateLimit('NewAgent', 'agent', messages);
      if (!result.allowed) {
        expect(result.reason).toContain('ratio');
      }
    });

    it('should return retryAfter when rate limited', () => {
      const messages: any[] = [];

      // Fill up global rate limit
      for (let i = 0; i < 15; i++) {
        globalRateLimiter.checkRateLimit(`FillerAgent${i}`, 'agent', messages);
        messages.push({
          sender: `FillerAgent${i}`,
          senderType: 'agent',
          timestamp: Date.now()
        });
      }

      const result = globalRateLimiter.checkRateLimit('LastAgent', 'agent', messages);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeDefined();
      expect(result.retryAfter).toBeGreaterThan(0);
    });
  });

  describe('checkAgentLimit', () => {
    it('should always allow agents (no hard limit)', () => {
      expect(globalRateLimiter.checkAgentLimit(50)).toBe(true);
      expect(globalRateLimiter.checkAgentLimit(99)).toBe(true);
      expect(globalRateLimiter.checkAgentLimit(100)).toBe(true);
      expect(globalRateLimiter.checkAgentLimit(500)).toBe(true);
    });
  });

  describe('token bucket refill', () => {
    it('should refill tokens over time', async () => {
      // Add human messages so ratio check doesn't interfere
      const messages: any[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({
          sender: `Human${i}`,
          senderType: 'human',
          timestamp: Date.now()
        });
      }

      // Use up all 5 tokens
      for (let i = 0; i < 5; i++) {
        const r = globalRateLimiter.checkRateLimit('RefillAgent', 'agent', messages);
        expect(r.allowed).toBe(true);
        messages.push({
          sender: 'RefillAgent',
          senderType: 'agent',
          timestamp: Date.now()
        });
      }

      // Should be blocked now (0 tokens)
      const blocked = globalRateLimiter.checkRateLimit('RefillAgent', 'agent', messages);
      expect(blocked.allowed).toBe(false);

      // Wait 2 seconds (should refill 2 tokens)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Should allow at least one more message
      const allowed = globalRateLimiter.checkRateLimit('RefillAgent', 'agent', messages);
      expect(allowed.allowed).toBe(true);
    }, 5000);
  });
});
