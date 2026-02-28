/**
 * Tests for mention-intel.ts
 */

import { describe, it, expect } from 'vitest';
import { MentionIntelligence } from '../mention-intel.js';
import type { Message } from '../chat-client.js';
import type { RoomContext } from '../context.js';

describe('MentionIntelligence', () => {
  const agentName = 'TestBot';
  const intel = new MentionIntelligence(agentName);
  const now = Date.now();

  const baseContext: RoomContext = {
    myName: agentName,
    isNewMember: false,
    memberList: [],
    recentEvents: [],
    conversationDynamics: {
      activeSpeakers: [],
      recentTopics: [],
    },
  };

  it('should respond when directly mentioned', () => {
    const msg: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: '@TestBot hello',
      mentions: ['TestBot'],
      timestamp: now,
    };

    const decision = intel.shouldRespond(msg, baseContext, []);
    expect(decision.respond).toBe(true);
    expect(decision.reason).toBe('directly_mentioned');
    expect(decision.replyTo).toBe('msg1');
  });

  it('should skip when reply saturation reached', () => {
    const msg: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: 'What do you think?',
      mentions: [],
      timestamp: now - 5 * 60 * 1000,
    };

    const recentMessages: Message[] = [
      msg,
      {
        id: 'msg2',
        sender: 'BotA',
        senderType: 'agent',
        content: 'I think it is good',
        mentions: [],
        replyTo: 'msg1',
        timestamp: now - 4 * 60 * 1000,
      },
      {
        id: 'msg3',
        sender: 'BotB',
        senderType: 'agent',
        content: 'I agree',
        mentions: [],
        replyTo: 'msg1',
        timestamp: now - 3 * 60 * 1000,
      },
    ];

    const decision = intel.shouldRespond(msg, baseContext, recentMessages);
    expect(decision.respond).toBe(false);
    expect(decision.reason).toBe('reply_saturation');
  });

  it('should skip when ongoing thread without agent', () => {
    const msg: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: 'Yes exactly',
      mentions: [],
      timestamp: now,
    };

    const contextWithThread: RoomContext = {
      ...baseContext,
      conversationDynamics: {
        activeSpeakers: ['Alice', 'Bob'],
        ongoingThread: {
          participants: ['Alice', 'Bob'],
          topic: 'private discussion',
        },
        recentTopics: [],
      },
    };

    const decision = intel.shouldRespond(msg, contextWithThread, []);
    expect(decision.respond).toBe(false);
    expect(decision.reason).toBe('ongoing_thread');
  });

  it('should respond to new member greeting', () => {
    const msg: Message = {
      id: 'msg1',
      sender: 'NewUser',
      senderType: 'human',
      content: 'Hi everyone, just joined!',
      mentions: [],
      timestamp: now,
    };

    const contextWithNewMember: RoomContext = {
      ...baseContext,
      memberList: [
        {
          name: 'NewUser',
          type: 'human',
          joinedAt: now - 2 * 60 * 1000,
          isNew: true,
          messageCount: 0,
        },
      ],
    };

    const recentMessages: Message[] = [msg];

    const decision = intel.shouldRespond(msg, contextWithNewMember, recentMessages);
    expect(decision.respond).toBe(true);
    expect(decision.reason).toBe('new_member_greeting');
    expect(decision.replyTo).toBe('msg1');
  });

  it('should allow general response', () => {
    const msg: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: 'What is the weather today?',
      mentions: [],
      timestamp: now,
    };

    const decision = intel.shouldRespond(msg, baseContext, []);
    expect(decision.respond).toBe(true);
    expect(decision.reason).toBe('general');
  });

  it('should count agent replies correctly', () => {
    const recentMessages: Message[] = [
      {
        id: 'msg1',
        sender: 'Alice',
        senderType: 'human',
        content: 'Question',
        mentions: [],
        timestamp: now - 5 * 60 * 1000,
      },
      {
        id: 'msg2',
        sender: 'BotA',
        senderType: 'agent',
        content: 'Answer',
        mentions: [],
        replyTo: 'msg1',
        timestamp: now - 4 * 60 * 1000,
      },
      {
        id: 'msg3',
        sender: 'Bob',
        senderType: 'human',
        content: 'Another reply',
        mentions: [],
        replyTo: 'msg1',
        timestamp: now - 3 * 60 * 1000,
      },
      {
        id: 'msg4',
        sender: 'BotB',
        senderType: 'agent',
        content: 'Also answer',
        mentions: [],
        replyTo: 'msg1',
        timestamp: now - 2 * 60 * 1000,
      },
    ];

    const count = intel.getAgentReplyCount('msg1', recentMessages);
    expect(count).toBe(2);
  });

  it('should prioritize direct mention over reply saturation', () => {
    const msg: Message = {
      id: 'msg1',
      sender: 'Alice',
      senderType: 'human',
      content: '@TestBot what do you think?',
      mentions: ['TestBot'],
      timestamp: now,
    };

    const recentMessages: Message[] = [
      msg,
      {
        id: 'msg2',
        sender: 'BotA',
        senderType: 'agent',
        content: 'I think yes',
        mentions: [],
        replyTo: 'msg1',
        timestamp: now - 1 * 60 * 1000,
      },
      {
        id: 'msg3',
        sender: 'BotB',
        senderType: 'agent',
        content: 'I agree',
        mentions: [],
        replyTo: 'msg1',
        timestamp: now - 30 * 1000,
      },
    ];

    const decision = intel.shouldRespond(msg, baseContext, recentMessages);
    expect(decision.respond).toBe(true);
    expect(decision.reason).toBe('directly_mentioned');
  });
});
