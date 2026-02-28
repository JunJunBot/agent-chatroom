/**
 * Room context building for enhanced chatroom awareness
 */

import type { Message, Member } from './chat-client.js';

export interface MemberInfo {
  name: string;
  type: 'human' | 'agent';
  joinedAt: number;
  isNew: boolean; // joined < 5 minutes ago
  messageCount: number;
}

export interface RoomEvent {
  type: 'join' | 'leave' | 'mute' | 'kick';
  name: string;
  timestamp: number;
  details?: string;
}

export interface ConversationDynamics {
  activeSpeakers: string[]; // speakers in last 5 minutes
  dominantSpeaker?: string; // most messages in last 5 min
  ongoingThread?: { participants: string[]; topic: string };
  recentTopics: string[]; // extracted from recent messages
}

export interface RoomContext {
  myName: string;
  isNewMember: boolean;
  memberList: MemberInfo[];
  recentEvents: RoomEvent[];
  conversationDynamics: ConversationDynamics;
}

/**
 * Build comprehensive room context for the agent
 */
export function buildRoomContext(
  agentName: string,
  members: Member[],
  messages: Message[],
  events?: RoomEvent[],
): RoomContext {
  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1000;

  // Find agent's join time
  const agentMember = members.find(m => m.name === agentName);
  const isNewMember = agentMember ? (now - agentMember.joinedAt < 5 * 60 * 1000) : false;

  // Build member list with activity info
  const memberList: MemberInfo[] = members.map(member => {
    const messageCount = messages.filter(m => m.sender === member.name).length;
    return {
      name: member.name,
      type: member.type,
      joinedAt: member.joinedAt,
      isNew: now - member.joinedAt < 5 * 60 * 1000,
      messageCount,
    };
  });

  // Conversation dynamics
  const recentMessages = messages.filter(m => m.timestamp >= fiveMinutesAgo);
  const activeSpeakers = [...new Set(recentMessages.map(m => m.sender))];

  // Find dominant speaker (most messages in last 5 min)
  const speakerCounts = new Map<string, number>();
  for (const msg of recentMessages) {
    speakerCounts.set(msg.sender, (speakerCounts.get(msg.sender) || 0) + 1);
  }
  let dominantSpeaker: string | undefined;
  let maxCount = 0;
  for (const [speaker, count] of speakerCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      dominantSpeaker = speaker;
    }
  }

  // Detect ongoing thread (last 3+ messages involve same 2-3 people)
  let ongoingThread: { participants: string[]; topic: string } | undefined;
  if (messages.length >= 3) {
    const lastThree = messages.slice(-3);
    const threadParticipants = [...new Set(lastThree.map(m => m.sender))];
    if (threadParticipants.length >= 2 && threadParticipants.length <= 3) {
      // Extract simple topic from last message
      const topic = extractSimpleTopic(lastThree[lastThree.length - 1].content);
      ongoingThread = { participants: threadParticipants, topic };
    }
  }

  // Extract recent topics (simple keyword extraction)
  const recentTopics = extractTopics(messages.slice(-10));

  return {
    myName: agentName,
    isNewMember,
    memberList,
    recentEvents: events || [],
    conversationDynamics: {
      activeSpeakers,
      dominantSpeaker,
      ongoingThread,
      recentTopics,
    },
  };
}

/**
 * Extract simple topic from message (first meaningful phrase)
 */
function extractSimpleTopic(content: string): string {
  const words = content.split(/\s+/).filter(w => w.length > 4);
  return words.slice(0, 3).join(' ') || 'conversation';
}

/**
 * Extract topics from recent messages (simple keyword extraction)
 */
function extractTopics(messages: Message[]): string[] {
  const stopwords = new Set(['the', 'and', 'that', 'this', 'with', 'from', 'have', 'they', 'what', 'when', 'where', 'about', 'will', 'would', 'could', 'should']);
  const topics = new Set<string>();

  for (const msg of messages) {
    const words = msg.content.toLowerCase().split(/\s+/);
    for (const word of words) {
      const cleaned = word.replace(/[^a-z0-9]/g, '');
      if (cleaned.length > 4 && !stopwords.has(cleaned)) {
        topics.add(cleaned);
        if (topics.size >= 5) break;
      }
    }
    if (topics.size >= 5) break;
  }

  return Array.from(topics);
}
