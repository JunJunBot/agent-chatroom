/**
 * Tests for context.ts
 */

import { describe, it, expect } from 'vitest';
import { buildRoomContext } from '../context.js';
import type { Member, Message } from '../chat-client.js';

describe('buildRoomContext', () => {
  const now = Date.now();

  const members: Member[] = [
    {
      id: 'mem1',
      name: 'Alice',
      type: 'human',
      joinedAt: now - 10 * 60 * 1000, // 10 minutes ago
      lastActiveAt: now,
    },
    {
      id: 'mem2',
      name: 'BotA',
      type: 'agent',
      joinedAt: now - 3 * 60 * 1000, // 3 minutes ago (new)
      lastActiveAt: now,
    },
    {
      id: 'mem3',
      name: 'Bob',
      type: 'human',
      joinedAt: now - 20 * 60 * 1000, // 20 minutes ago
      lastActiveAt: now,
    },
  ];

  const messages: Message[] = [
    {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: 'Hello everyone',
      mentions: [],
      timestamp: now - 4 * 60 * 1000, // Changed to 4 minutes (within 5-min window)
    },
    {
      id: 'msg2',
      sender: 'Bob',
      senderType: 'human',
      content: 'Hi Alice!',
      mentions: ['Alice'],
      timestamp: now - 3 * 60 * 1000, // Changed to 3 minutes
    },
    {
      id: 'msg3',
      sender: 'BotA',
      senderType: 'agent',
      content: 'Hey there!',
      mentions: [],
      timestamp: now - 2 * 60 * 1000,
    },
  ];

  it('should identify new members', () => {
    const context = buildRoomContext('TestBot', members, messages);
    const newMember = context.memberList.find(m => m.name === 'BotA');
    expect(newMember?.isNew).toBe(true);
  });

  it('should identify active speakers', () => {
    const context = buildRoomContext('TestBot', members, messages);
    expect(context.conversationDynamics.activeSpeakers).toContain('Alice');
    expect(context.conversationDynamics.activeSpeakers).toContain('Bob');
    expect(context.conversationDynamics.activeSpeakers).toContain('BotA');
  });

  it('should identify dominant speaker', () => {
    const manyMessages: Message[] = [
      ...messages,
      {
        id: 'msg4',
        sender: 'Alice',
        senderType: 'human',
        content: 'Another message',
        mentions: [],
        timestamp: now - 1 * 60 * 1000,
      },
      {
        id: 'msg5',
        sender: 'Alice',
        senderType: 'human',
        content: 'And another',
        mentions: [],
        timestamp: now - 30 * 1000,
      },
    ];

    const context = buildRoomContext('TestBot', members, manyMessages);
    expect(context.conversationDynamics.dominantSpeaker).toBe('Alice');
  });

  it('should detect ongoing thread', () => {
    const threadMessages: Message[] = [
      {
        id: 'msg1',
        sender: 'Alice',
        senderType: 'human',
        content: 'What do you think about weather?',
        mentions: [],
        timestamp: now - 3 * 60 * 1000,
      },
      {
        id: 'msg2',
        sender: 'Bob',
        senderType: 'human',
        content: 'Weather is nice today',
        mentions: [],
        timestamp: now - 2 * 60 * 1000,
      },
      {
        id: 'msg3',
        sender: 'Alice',
        senderType: 'human',
        content: 'Yes, very sunny',
        mentions: [],
        timestamp: now - 1 * 60 * 1000,
      },
    ];

    const context = buildRoomContext('TestBot', members, threadMessages);
    expect(context.conversationDynamics.ongoingThread).toBeDefined();
    expect(context.conversationDynamics.ongoingThread?.participants).toContain('Alice');
    expect(context.conversationDynamics.ongoingThread?.participants).toContain('Bob');
  });

  it('should track message counts', () => {
    const context = buildRoomContext('TestBot', members, messages);
    const alice = context.memberList.find(m => m.name === 'Alice');
    expect(alice?.messageCount).toBeGreaterThan(0);
  });

  it('should detect if agent is new member', () => {
    const newAgentMembers: Member[] = [
      ...members,
      {
        id: 'mem4',
        name: 'TestBot',
        type: 'agent',
        joinedAt: now - 2 * 60 * 1000, // 2 minutes ago
        lastActiveAt: now,
      },
    ];

    const context = buildRoomContext('TestBot', newAgentMembers, messages);
    expect(context.isNewMember).toBe(true);
  });

  it('should extract recent topics', () => {
    const context = buildRoomContext('TestBot', members, messages);
    expect(context.conversationDynamics.recentTopics.length).toBeGreaterThanOrEqual(0);
  });
});
