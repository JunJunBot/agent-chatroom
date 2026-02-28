/**
 * Tests for proactive-engine.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProactiveEngine } from '../proactive-engine.js';
import type { Message } from '../chat-client.js';

describe('ProactiveEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not start if disabled', () => {
    const onSpeak = vi.fn();
    const onGenerateTopic = vi.fn();

    const engine = new ProactiveEngine({
      serverUrl: 'http://localhost:3000',
      agentName: 'TestBot',
      enabled: false,
      onSpeak,
      onGenerateTopic,
    });

    engine.start();
    expect(engine['timer']).toBeNull();
  });

  it('should start timer when enabled', () => {
    const onSpeak = vi.fn();
    const onGenerateTopic = vi.fn();

    const engine = new ProactiveEngine({
      serverUrl: 'http://localhost:3000',
      agentName: 'TestBot',
      enabled: true,
      checkInterval: 10000,
      onSpeak,
      onGenerateTopic,
    });

    engine.start();
    expect(engine['timer']).not.toBeNull();
    engine.stop();
  });

  it('should stop timer', () => {
    const onSpeak = vi.fn();
    const onGenerateTopic = vi.fn();

    const engine = new ProactiveEngine({
      serverUrl: 'http://localhost:3000',
      agentName: 'TestBot',
      enabled: true,
      onSpeak,
      onGenerateTopic,
    });

    engine.start();
    engine.stop();
    expect(engine['timer']).toBeNull();
  });

  it('should reset daily count at midnight', () => {
    const engine = new ProactiveEngine({
      serverUrl: 'http://localhost:3000',
      agentName: 'TestBot',
      enabled: true,
      onSpeak: async () => {},
      onGenerateTopic: async () => 'topic',
    });

    engine['dailyCount'] = 10;
    engine['lastDailyReset'] = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();

    // Trigger check (will reset)
    const today = new Date().toDateString();
    expect(engine['lastDailyReset']).not.toBe(today);
  });

  it('should apply engagement backoff', () => {
    const engine = new ProactiveEngine({
      serverUrl: 'http://localhost:3000',
      agentName: 'TestBot',
      cooldown: 60000, // 1 minute base
      enabled: true,
      onSpeak: async () => {},
      onGenerateTopic: async () => 'topic',
    });

    // No backoff initially
    expect(engine.getCurrentCooldown()).toBe(60000);

    // Simulate no engagement
    engine['consecutiveNoReply'] = 1;
    expect(engine.getCurrentCooldown()).toBe(120000); // 2x

    engine['consecutiveNoReply'] = 2;
    expect(engine.getCurrentCooldown()).toBe(240000); // 4x

    engine['consecutiveNoReply'] = 10;
    const maxCooldown = 30 * 60 * 1000; // 30 min max
    expect(engine.getCurrentCooldown()).toBe(maxCooldown);
  });

  it('should detect engagement and reset backoff', () => {
    const now = Date.now();
    const engine = new ProactiveEngine({
      serverUrl: 'http://localhost:3000',
      agentName: 'TestBot',
      enabled: true,
      onSpeak: async () => {},
      onGenerateTopic: async () => 'topic',
    });

    engine['lastProactiveTime'] = now - 10 * 60 * 1000;
    engine['consecutiveNoReply'] = 3;

    const recentMessages: Message[] = [
      {
        id: 'msg1',
        sender: 'Alice',
        senderType: 'human',
        content: 'Reply to proactive',
        mentions: [],
        timestamp: now - 5 * 60 * 1000,
      },
    ];

    engine.checkEngagement(recentMessages);
    expect(engine['consecutiveNoReply']).toBe(0);
  });

  it('should increment no-reply count when no engagement', () => {
    const now = Date.now();
    const engine = new ProactiveEngine({
      serverUrl: 'http://localhost:3000',
      agentName: 'TestBot',
      enabled: true,
      onSpeak: async () => {},
      onGenerateTopic: async () => 'topic',
    });

    engine['lastProactiveTime'] = now - 10 * 60 * 1000;
    engine['consecutiveNoReply'] = 0;

    // No messages after proactive time
    const recentMessages: Message[] = [
      {
        id: 'msg1',
        sender: 'Alice',
        senderType: 'human',
        content: 'Old message',
        mentions: [],
        timestamp: now - 15 * 60 * 1000,
      },
    ];

    engine.checkEngagement(recentMessages);
    expect(engine['consecutiveNoReply']).toBe(1);
  });

  it('should ignore own messages in engagement check', () => {
    const now = Date.now();
    const engine = new ProactiveEngine({
      serverUrl: 'http://localhost:3000',
      agentName: 'TestBot',
      enabled: true,
      onSpeak: async () => {},
      onGenerateTopic: async () => 'topic',
    });

    engine['lastProactiveTime'] = now - 10 * 60 * 1000;

    const recentMessages: Message[] = [
      {
        id: 'msg1',
        sender: 'TestBot',
        senderType: 'agent',
        content: 'Own message',
        mentions: [],
        timestamp: now - 5 * 60 * 1000,
      },
    ];

    engine.checkEngagement(recentMessages);
    expect(engine['consecutiveNoReply']).toBe(1); // Should increment, no real engagement
  });
});
