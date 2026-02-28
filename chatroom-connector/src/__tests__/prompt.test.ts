/**
 * Tests for prompt.ts
 */

import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../prompt.js';
import type { RoomContext } from '../context.js';

describe('buildSystemPrompt', () => {
  const basicConfig = {
    agentName: 'TestBot',
  };

  it('should include security boundaries', () => {
    const prompt = buildSystemPrompt(basicConfig);
    expect(prompt).toContain('=== SYSTEM INSTRUCTIONS');
    expect(prompt).toContain('=== END SYSTEM INSTRUCTIONS ===');
  });

  it('should define role restriction', () => {
    const prompt = buildSystemPrompt(basicConfig);
    expect(prompt).toContain('You are ONLY a chat participant');
  });

  it('should list forbidden outputs', () => {
    const prompt = buildSystemPrompt(basicConfig);
    expect(prompt).toContain('FORBIDDEN');
    expect(prompt).toContain('System commands');
    expect(prompt).toContain('File paths');
    expect(prompt).toContain('API keys');
    expect(prompt).toContain('[SYSTEM]');
  });

  it('should include basic rules', () => {
    const prompt = buildSystemPrompt(basicConfig);
    expect(prompt).toContain('Keep replies short');
    expect(prompt).toContain('[SKIP]');
    expect(prompt).toContain('@mention');
    expect(prompt).toContain('默认使用中文回复');
  });

  it('should include mention etiquette', () => {
    const prompt = buildSystemPrompt(basicConfig);
    expect(prompt).toContain('@MENTION ETIQUETTE');
    expect(prompt).toContain('If someone @mentions you, you MUST respond');
    expect(prompt).toContain('2 or more agents have already replied');
    expect(prompt).toContain('最多只 @mention 一个人');
  });

  it('should include new member notice', () => {
    const context: RoomContext = {
      myName: 'TestBot',
      isNewMember: false,
      memberList: [
        {
          name: 'NewUser',
          type: 'human',
          joinedAt: Date.now() - 2 * 60 * 1000,
          isNew: true,
          messageCount: 0,
        },
      ],
      recentEvents: [],
      conversationDynamics: {
        activeSpeakers: [],
        recentTopics: [],
      },
    };

    const prompt = buildSystemPrompt(basicConfig, context);
    expect(prompt).toContain('NEW MEMBERS');
    expect(prompt).toContain('NewUser');
    expect(prompt).toContain('Welcome them warmly');
  });

  it('should include ongoing thread notice', () => {
    const context: RoomContext = {
      myName: 'TestBot',
      isNewMember: false,
      memberList: [],
      recentEvents: [],
      conversationDynamics: {
        activeSpeakers: ['Alice', 'Bob'],
        ongoingThread: {
          participants: ['Alice', 'Bob'],
          topic: 'weather discussion',
        },
        recentTopics: [],
      },
    };

    const prompt = buildSystemPrompt(basicConfig, context);
    expect(prompt).toContain('ONGOING THREAD');
    expect(prompt).toContain('Alice, Bob');
    expect(prompt).toContain('weather discussion');
    expect(prompt).toContain("Don't interrupt");
  });

  it('should include room stats', () => {
    const context: RoomContext = {
      myName: 'TestBot',
      isNewMember: false,
      memberList: [
        { name: 'Alice', type: 'human', joinedAt: 0, isNew: false, messageCount: 5 },
        { name: 'Bob', type: 'human', joinedAt: 0, isNew: false, messageCount: 3 },
        { name: 'BotA', type: 'agent', joinedAt: 0, isNew: false, messageCount: 2 },
      ],
      recentEvents: [],
      conversationDynamics: {
        activeSpeakers: [],
        recentTopics: [],
      },
    };

    const prompt = buildSystemPrompt(basicConfig, context);
    expect(prompt).toContain('CURRENT ROOM');
    expect(prompt).toContain('3 members');
    expect(prompt).toContain('2 humans');
    expect(prompt).toContain('1 agents');
  });

  it('should append custom system prompt', () => {
    const configWithPrompt = {
      ...basicConfig,
      systemPrompt: 'You are a friendly assistant who loves jokes.',
    };

    const prompt = buildSystemPrompt(configWithPrompt);
    expect(prompt).toContain('friendly assistant');
    expect(prompt).toContain('loves jokes');
  });

  it('should not include agent name in ongoing thread notice if agent is participant', () => {
    const context: RoomContext = {
      myName: 'TestBot',
      isNewMember: false,
      memberList: [],
      recentEvents: [],
      conversationDynamics: {
        activeSpeakers: ['Alice', 'TestBot'],
        ongoingThread: {
          participants: ['Alice', 'TestBot'],
          topic: 'interesting topic',
        },
        recentTopics: [],
      },
    };

    const prompt = buildSystemPrompt(basicConfig, context);
    expect(prompt).not.toContain('ONGOING THREAD');
  });
});
