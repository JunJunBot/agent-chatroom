/**
 * Tests for strategy.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ReplyStrategy } from '../strategy.js';
import type { Message } from '../chat-client.js';

describe('ReplyStrategy', () => {
  const config = {
    agentName: 'TestBot',
    replyProbability: 0.9,
    mentionAlwaysReply: true,
    cooldownMin: 5000,
    cooldownMax: 15000,
  };

  let strategy: ReplyStrategy;

  beforeEach(() => {
    strategy = new ReplyStrategy(config);
  });

  it('should detect mentions', () => {
    const msg: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: '@TestBot hello',
      mentions: ['TestBot'],
      timestamp: Date.now(),
    };

    expect(strategy.isMentioned(msg)).toBe(true);
  });

  it('should detect mentions case-insensitively', () => {
    const msg: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: '@testbot hello',
      mentions: ['testbot'],
      timestamp: Date.now(),
    };

    expect(strategy.isMentioned(msg)).toBe(true);
  });

  it('should always reply when mentioned', () => {
    const msg: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: '@TestBot hello',
      mentions: ['TestBot'],
      timestamp: Date.now(),
    };

    expect(strategy.shouldReply(msg)).toBe(true);
  });

  it('should ignore own messages', () => {
    const msg: Message = {
      id: 'msg1',
      sender: 'TestBot',
      senderType: 'agent',
      content: 'My message',
      mentions: [],
      timestamp: Date.now(),
    };

    expect(strategy.shouldReply(msg)).toBe(false);
  });

  it('should respect cooldown', () => {
    const msg1: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: 'First message',
      mentions: [],
      timestamp: Date.now(),
    };

    const msg2: Message = {
      id: 'msg2',
      sender: 'Bob',
      senderType: 'human',
      content: 'Second message',
      mentions: [],
      timestamp: Date.now(),
    };

    // First message might reply (probability)
    strategy.startCooldown();

    // Should be in cooldown now
    expect(strategy.isInCooldown()).toBe(true);
    expect(strategy.shouldReply(msg2)).toBe(false);
  });

  it('should bypass cooldown when mentioned', () => {
    const msg1: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: 'First',
      mentions: [],
      timestamp: Date.now(),
    };

    strategy.startCooldown();
    expect(strategy.isInCooldown()).toBe(true);

    const msg2: Message = {
      id: 'msg2',
      sender: 'Bob',
      senderType: 'human',
      content: '@TestBot urgent',
      mentions: ['TestBot'],
      timestamp: Date.now(),
    };

    expect(strategy.shouldReply(msg2)).toBe(true);
  });

  it('should calculate cooldown remaining', () => {
    strategy.startCooldown();
    const remaining = strategy.getCooldownRemaining();
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(config.cooldownMax);
  });

  it('should apply backoff on rate limit', () => {
    const initialBackoff = strategy['backoffMultiplier'];
    expect(initialBackoff).toBe(1);

    strategy.recordRateLimit();
    expect(strategy['backoffMultiplier']).toBe(2);

    strategy.recordRateLimit();
    expect(strategy['backoffMultiplier']).toBe(4);

    strategy.recordRateLimit();
    expect(strategy['backoffMultiplier']).toBe(8);
  });

  it('should cap backoff at max', () => {
    // Simulate many rate limits
    for (let i = 0; i < 20; i++) {
      strategy.recordRateLimit();
    }

    const maxBackoff = strategy['maxBackoff'] / config.cooldownMin;
    expect(strategy['backoffMultiplier']).toBeLessThanOrEqual(maxBackoff);
  });

  it('should reset backoff', () => {
    strategy.recordRateLimit();
    strategy.recordRateLimit();
    expect(strategy['backoffMultiplier']).toBeGreaterThan(1);

    strategy.resetBackoff();
    expect(strategy['backoffMultiplier']).toBe(1);
  });

  it('should apply backoff to cooldown', () => {
    strategy['backoffMultiplier'] = 4;
    strategy['currentCooldown'] = config.cooldownMax * 4;
    strategy['lastReplyTime'] = Date.now();

    const remaining = strategy.getCooldownRemaining();
    expect(remaining).toBeGreaterThan(config.cooldownMax);
  });

  it('should respect reply probability', () => {
    const lowProbStrategy = new ReplyStrategy({
      ...config,
      replyProbability: 0,
    });

    const msg: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: 'Hello',
      mentions: [],
      timestamp: Date.now(),
    };

    // With 0 probability, should never reply (unless mentioned)
    expect(lowProbStrategy.shouldReply(msg)).toBe(false);
  });

  it('should randomize cooldown duration', () => {
    strategy.startCooldown();
    const cooldown1 = strategy['currentCooldown'];

    strategy.startCooldown();
    const cooldown2 = strategy['currentCooldown'];

    // Both should be in valid range
    expect(cooldown1).toBeGreaterThanOrEqual(config.cooldownMin);
    expect(cooldown1).toBeLessThanOrEqual(config.cooldownMax);
    expect(cooldown2).toBeGreaterThanOrEqual(config.cooldownMin);
    expect(cooldown2).toBeLessThanOrEqual(config.cooldownMax);
  });
});
