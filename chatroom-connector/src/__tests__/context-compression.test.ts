/**
 * Tests for context-compression.ts
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  traceReplyChain,
  calculateImportance,
  compressContext,
} from '../context-compression.js';
import type { Message } from '../chat-client.js';

describe('estimateTokens', () => {
  it('should estimate English text tokens', () => {
    const text = 'Hello world this is a test'; // ~7 words, ~26 chars, ~6.5 tokens
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(10);
  });

  it('should estimate Chinese text tokens', () => {
    const text = '你好世界这是测试'; // 8 CJK chars, ~4 tokens
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(3);
    expect(tokens).toBeLessThan(6);
  });

  it('should estimate mixed text tokens', () => {
    const text = 'Hello 世界 world 测试'; // Mixed
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(3);
    expect(tokens).toBeLessThan(10);
  });
});

describe('traceReplyChain', () => {
  const messages: Message[] = [
    {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: 'Original question',
      mentions: [],
      timestamp: 1000,
    },
    {
      id: 'msg2',
      sender: 'Bob',
      senderType: 'human',
      content: 'First reply',
      mentions: [],
      replyTo: 'msg1',
      timestamp: 2000,
    },
    {
      id: 'msg3',
      sender: 'Charlie',
      senderType: 'human',
      content: 'Second reply',
      mentions: [],
      replyTo: 'msg2',
      timestamp: 3000,
    },
  ];

  it('should trace reply chain', () => {
    const chain = traceReplyChain('msg3', messages);
    expect(chain).toHaveLength(3);
    expect(chain[0].id).toBe('msg1');
    expect(chain[1].id).toBe('msg2');
    expect(chain[2].id).toBe('msg3');
  });

  it('should respect max depth', () => {
    const chain = traceReplyChain('msg3', messages, 2);
    expect(chain.length).toBeLessThanOrEqual(2);
  });

  it('should handle cycle detection', () => {
    const cyclicMessages: Message[] = [
      {
        id: 'msg1',
        sender: 'A',
        senderType: 'human',
        content: 'A',
        mentions: [],
        replyTo: 'msg2',
        timestamp: 1000,
      },
      {
        id: 'msg2',
        sender: 'B',
        senderType: 'human',
        content: 'B',
        mentions: [],
        replyTo: 'msg1',
        timestamp: 2000,
      },
    ];

    const chain = traceReplyChain('msg2', cyclicMessages);
    expect(chain.length).toBeLessThan(10); // Should not infinite loop
  });

  it('should return empty for missing message', () => {
    const chain = traceReplyChain('msg99', messages);
    expect(chain).toHaveLength(0);
  });
});

describe('calculateImportance', () => {
  it('should assign base score', () => {
    const msg: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: 'Hello',
      mentions: [],
      timestamp: 1000,
    };

    const score = calculateImportance(msg, 'TestBot');
    expect(score).toBeGreaterThanOrEqual(0.3);
  });

  it('should boost score for mentions', () => {
    const msg: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: '@TestBot hello',
      mentions: ['TestBot'],
      timestamp: 1000,
    };

    const score = calculateImportance(msg, 'TestBot');
    expect(score).toBeGreaterThanOrEqual(0.6);
  });

  it('should boost score for questions', () => {
    const msg: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: 'What is the weather?',
      mentions: [],
      timestamp: 1000,
    };

    const score = calculateImportance(msg, 'TestBot');
    expect(score).toBeGreaterThanOrEqual(0.5);
  });

  it('should boost score for replies', () => {
    const msg: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: 'Response',
      mentions: [],
      replyTo: 'msg0',
      timestamp: 1000,
    };

    const score = calculateImportance(msg, 'TestBot');
    expect(score).toBeGreaterThanOrEqual(0.4);
  });

  it('should cap score at 1.0', () => {
    const msg: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: '@TestBot what is the weather?',
      mentions: ['TestBot'],
      replyTo: 'msg0',
      timestamp: 1000,
    };

    const score = calculateImportance(msg, 'TestBot');
    expect(score).toBeLessThanOrEqual(1.0);
  });
});

describe('compressContext', () => {
  const messages: Message[] = [
    {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: 'Old message',
      mentions: [],
      timestamp: 1000,
    },
    {
      id: 'msg2',
      sender: 'Bob',
      senderType: 'human',
      content: '@TestBot important question?',
      mentions: ['TestBot'],
      timestamp: 2000,
    },
    {
      id: 'msg3',
      sender: 'Charlie',
      senderType: 'human',
      content: 'Recent message',
      mentions: [],
      timestamp: 3000,
    },
  ];

  const trigger = messages[2];

  it('should compress with recent strategy', () => {
    const compressed = compressContext(messages, trigger, {
      strategy: 'recent',
      maxTokens: 50,
      agentName: 'TestBot',
    });

    expect(compressed.length).toBeGreaterThan(0);
    expect(compressed.length).toBeLessThanOrEqual(messages.length);
  });

  it('should compress with important strategy', () => {
    const compressed = compressContext(messages, trigger, {
      strategy: 'important',
      maxTokens: 50,
      agentName: 'TestBot',
    });

    expect(compressed.length).toBeGreaterThan(0);
    // Should prioritize message with mention
    const hasMention = compressed.some(m => m.mentions.includes('TestBot'));
    expect(hasMention).toBe(true);
  });

  it('should compress with hybrid strategy', () => {
    const compressed = compressContext(messages, trigger, {
      strategy: 'hybrid',
      maxTokens: 100,
      agentName: 'TestBot',
    });

    expect(compressed.length).toBeGreaterThan(0);
  });

  it('should respect token budget', () => {
    const longMessages: Message[] = Array.from({ length: 20 }, (_, i) => ({
      id: `msg${i}`,
      sender: 'User',
      senderType: 'human' as const,
      content: 'This is a relatively long message that will consume tokens in the budget calculation',
      mentions: [],
      timestamp: 1000 + i * 1000,
    }));

    const compressed = compressContext(longMessages, longMessages[19], {
      strategy: 'recent',
      maxTokens: 50,
      agentName: 'TestBot',
    });

    // Should compress to fit budget
    expect(compressed.length).toBeLessThan(longMessages.length);
  });

  it('should return messages in chronological order', () => {
    const compressed = compressContext(messages, trigger, {
      strategy: 'important',
      maxTokens: 200,
      agentName: 'TestBot',
    });

    for (let i = 1; i < compressed.length; i++) {
      expect(compressed[i].timestamp).toBeGreaterThanOrEqual(compressed[i - 1].timestamp);
    }
  });

  it('should use default options', () => {
    const compressed = compressContext(messages, trigger, {
      agentName: 'TestBot',
    });

    expect(compressed.length).toBeGreaterThan(0);
  });
});
