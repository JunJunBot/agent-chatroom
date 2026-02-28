/**
 * Tests for formatting.ts
 */

import { describe, it, expect } from 'vitest';
import { formatChatHistory } from '../formatting.js';
import type { Message } from '../chat-client.js';
import type { RoomContext } from '../context.js';

describe('formatChatHistory', () => {
  const now = Date.now();

  const messages: Message[] = [
    {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: 'Hello everyone',
      mentions: [],
      timestamp: now - 10 * 60 * 1000,
    },
    {
      id: 'msg2',
      sender: 'BotA',
      senderType: 'agent',
      content: 'Hi Alice!',
      mentions: ['Alice'],
      replyTo: 'msg1',
      timestamp: now - 8 * 60 * 1000,
    },
    {
      id: 'msg3',
      sender: 'Bob',
      senderType: 'human',
      content: '@BotA how are you?',
      mentions: ['BotA'],
      timestamp: now - 2 * 60 * 1000,
    },
  ];

  const trigger: Message = messages[2];

  it('should prefix agent messages with [Agent]', () => {
    const result = formatChatHistory(messages, trigger);
    expect(result).toContain('[Agent] BotA');
  });

  it('should prefix human messages with [Human]', () => {
    const result = formatChatHistory(messages, trigger);
    expect(result).toContain('[Human] Alice');
    expect(result).toContain('[Human] Bob');
  });

  it('should show reply chain markers', () => {
    const result = formatChatHistory(messages, trigger);
    expect(result).toContain('(replying to Alice)');
  });

  it('should insert time gap markers', () => {
    const gapMessages: Message[] = [
      {
        id: 'msg1',
        sender: 'Alice',
        senderType: 'human',
        content: 'First message',
        mentions: [],
        timestamp: now - 20 * 60 * 1000,
      },
      {
        id: 'msg2',
        sender: 'Bob',
        senderType: 'human',
        content: 'After long silence',
        mentions: [],
        timestamp: now - 1 * 60 * 1000,
      },
    ];

    const result = formatChatHistory(gapMessages, gapMessages[1]);
    expect(result).toContain('[5+ minutes of silence]');
  });

  it('should highlight mentions of the agent', () => {
    const context: RoomContext = {
      myName: 'BotA',
      isNewMember: false,
      memberList: [],
      recentEvents: [],
      conversationDynamics: {
        activeSpeakers: [],
        recentTopics: [],
      },
    };

    const result = formatChatHistory(messages, trigger, context);
    expect(result).toContain('>>>');
    expect(result).toContain('<<<');
  });

  it('should truncate long messages', () => {
    const longMessage: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: 'a'.repeat(500),
      mentions: [],
      timestamp: now,
    };

    const result = formatChatHistory([longMessage], longMessage);
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(600);
  });

  it('should insert system events', () => {
    const context: RoomContext = {
      myName: 'TestBot',
      isNewMember: false,
      memberList: [],
      recentEvents: [
        {
          type: 'join',
          name: 'Charlie',
          timestamp: now - 5 * 60 * 1000,
        },
      ],
      conversationDynamics: {
        activeSpeakers: [],
        recentTopics: [],
      },
    };

    const result = formatChatHistory(messages, trigger, context);
    expect(result).toContain('[SYSTEM] Charlie join the room');
  });

  it('should include trigger message if not in history', () => {
    const newTrigger: Message = {
      id: 'msg99',
      sender: 'NewUser',
      senderType: 'human',
      content: 'New message',
      mentions: [],
      timestamp: now,
    };

    const result = formatChatHistory(messages, newTrigger);
    expect(result).toContain('NewUser');
    expect(result).toContain('New message');
  });
});
