import { nanoid } from 'nanoid';

export interface Message {
  id: string;
  sender: string;
  senderType: 'human' | 'agent';
  content: string;
  mentions: string[];
  replyTo?: string;
  timestamp: number;
}

export interface Member {
  id: string;
  name: string;
  type: 'human' | 'agent';
  joinedAt: number;
  lastActiveAt: number;
}

class Store {
  private messages: Message[] = [];
  private members: Map<string, Member> = new Map();
  private lastMessageTime: Map<string, number> = new Map();

  // Add a member
  addMember(name: string, type: 'human' | 'agent'): { member: Member; isNew: boolean } {
    // Check if member already exists
    const existing = Array.from(this.members.values()).find(m => m.name === name);
    if (existing) {
      existing.lastActiveAt = Date.now();
      return { member: existing, isNew: false };
    }

    const member: Member = {
      id: `mem_${nanoid(10)}`,
      name,
      type,
      joinedAt: Date.now(),
      lastActiveAt: Date.now()
    };

    this.members.set(member.id, member);
    return { member, isNew: true };
  }

  // Get all members
  getMembers(): Member[] {
    return Array.from(this.members.values());
  }

  // Update member activity
  updateMemberActivity(name: string): void {
    const member = Array.from(this.members.values()).find(m => m.name === name);
    if (member) {
      member.lastActiveAt = Date.now();
    }
  }

  // Add a message
  addMessage(sender: string, senderType: 'human' | 'agent', content: string, replyTo?: string): Message {
    const mentions = this.extractMentions(content);

    const message: Message = {
      id: `msg_${nanoid(10)}`,
      sender,
      senderType,
      content,
      mentions,
      replyTo,
      timestamp: Date.now()
    };

    this.messages.push(message);
    this.lastMessageTime.set(sender, Date.now());
    this.updateMemberActivity(sender);

    return message;
  }

  // Get messages since timestamp
  getMessages(since: number = 0, limit: number = 50): Message[] {
    const filtered = this.messages.filter(m => m.timestamp > since);
    return filtered.slice(-limit);
  }

  // Get all messages
  getAllMessages(): Message[] {
    return [...this.messages];
  }

  // Check rate limit
  checkRateLimit(sender: string, minInterval: number = 5000): { allowed: boolean; retryAfter: number } {
    const lastTime = this.lastMessageTime.get(sender);
    if (!lastTime) {
      return { allowed: true, retryAfter: 0 };
    }

    const elapsed = Date.now() - lastTime;
    const allowed = elapsed >= minInterval;
    const retryAfter = allowed ? 0 : minInterval - elapsed;

    return { allowed, retryAfter };
  }

  // Check consecutive agent messages
  getConsecutiveAgentCount(): number {
    let count = 0;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].senderType === 'agent') {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  // Extract @mentions from content
  private extractMentions(content: string): string[] {
    const mentionRegex = /@(\w+)/g;
    const mentions: string[] = [];
    let match;

    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[1]);
    }

    return mentions;
  }
}

export const store = new Store();
