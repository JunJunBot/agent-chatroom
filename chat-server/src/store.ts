import { nanoid } from 'nanoid';
import * as fs from 'fs';
import * as path from 'path';

export interface Message {
  id: string;
  sender: string;
  senderType: 'human' | 'agent';
  content: string;
  mentions: string[];
  replyTo?: string;
  timestamp: number;
  deleted?: boolean;
  importance?: number;
  isProactive?: boolean;
  eventType?: string;
}

export interface Member {
  id: string;
  name: string;
  type: 'human' | 'agent';
  joinedAt: number;
  lastActiveAt: number;
  role?: 'user' | 'admin';
  muted?: boolean;
  mutedUntil?: number;
  messageCount?: number;
}

// ============ Persistence ============
const DATA_DIR = process.env.DATA_DIR || '/data';
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.jsonl');

class Store {
  private messages: Message[] = [];
  private members: Map<string, Member> = new Map();
  private lastMessageTime: Map<string, number> = new Map();
  private proactiveLock: { agent: string; until: number } | null = null;
  private writeStream: fs.WriteStream | null = null;

  constructor() {
    this.loadFromDisk();
    this.openWriteStream();
  }

  // Load persisted messages from JSONL file
  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(MESSAGES_FILE)) {
        console.log(`[Store] No persistence file found at ${MESSAGES_FILE}, starting fresh`);
        return;
      }

      const data = fs.readFileSync(MESSAGES_FILE, 'utf-8');
      const lines = data.trim().split('\n').filter(Boolean);
      let loaded = 0;

      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as Message;
          this.messages.push(msg);
          loaded++;
        } catch {
          // Skip corrupted lines
        }
      }

      console.log(`[Store] Loaded ${loaded} messages from disk`);
    } catch (err: any) {
      console.error(`[Store] Failed to load from disk: ${err.message}`);
    }
  }

  // Open append-only write stream for persistence
  private openWriteStream(): void {
    try {
      // Ensure data directory exists
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      this.writeStream = fs.createWriteStream(MESSAGES_FILE, { flags: 'a' });
      console.log(`[Store] Persistence enabled: ${MESSAGES_FILE}`);
    } catch (err: any) {
      console.error(`[Store] Failed to open write stream: ${err.message}`);
    }
  }

  // Persist a single message to disk
  private persistMessage(message: Message): void {
    if (!this.writeStream) return;
    try {
      this.writeStream.write(JSON.stringify(message) + '\n');
    } catch (err: any) {
      console.error(`[Store] Failed to persist message: ${err.message}`);
    }
  }

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
    this.persistMessage(message);
    this.lastMessageTime.set(sender, Date.now());
    this.updateMemberActivity(sender);

    return message;
  }

  // Get messages since timestamp
  getMessages(since: number = 0, limit: number = 50): Message[] {
    const filtered = this.messages.filter(m => m.timestamp > since);
    return filtered.slice(-limit);
  }

  // Get messages before a timestamp (for backward pagination / infinite scroll)
  getMessagesBefore(before: number, limit: number = 50): Message[] {
    const filtered = this.messages.filter(m => m.timestamp < before);
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

  // Extract @mentions from content, validated against known members
  private extractMentions(content: string): string[] {
    const memberNames = Array.from(this.members.values()).map(m => m.name);
    const mentions: string[] = [];

    // Try to match each known member name after @
    for (const name of memberNames) {
      if (content.includes(`@${name}`)) {
        mentions.push(name);
      }
    }

    return mentions;
  }

  // Get member by name
  getMemberByName(name: string): Member | undefined {
    return Array.from(this.members.values()).find(m => m.name === name);
  }

  // Delete member by name
  deleteMember(name: string): boolean {
    const member = this.getMemberByName(name);
    if (!member) {
      return false;
    }
    this.members.delete(member.id);
    return true;
  }

  // Get activity status
  getActivityStatus(): { isIdle: boolean; lastMessageTime: number; activeMembers: string[]; messageCount: number } {
    const now = Date.now();
    const lastMessage = this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
    const lastMessageTime = lastMessage ? lastMessage.timestamp : 0;
    const isIdle = lastMessage ? (now - lastMessage.timestamp) > 60000 : true;

    // Members who sent messages in last 5 minutes
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const recentSenders = new Set<string>();
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].timestamp < fiveMinutesAgo) {
        break;
      }
      recentSenders.add(this.messages[i].sender);
    }

    return {
      isIdle,
      lastMessageTime,
      activeMembers: Array.from(recentSenders),
      messageCount: this.messages.length
    };
  }

  // Request proactive turn for agent
  requestProactiveTurn(agentName: string): { granted: boolean; lockUntil?: number } {
    const now = Date.now();

    // Check if there's an active lock
    if (this.proactiveLock && this.proactiveLock.until > now) {
      return { granted: false };
    }

    // Grant lock for 30 seconds
    const lockUntil = now + 30000;
    this.proactiveLock = { agent: agentName, until: lockUntil };

    return { granted: true, lockUntil };
  }

  // Get message by ID
  getMessageById(id: string): Message | undefined {
    return this.messages.find(m => m.id === id);
  }

  // Increment message count for member
  incrementMessageCount(name: string): void {
    const member = this.getMemberByName(name);
    if (member) {
      member.messageCount = (member.messageCount || 0) + 1;
    }
  }

  // Clean up inactive members (no activity in last N ms)
  cleanupInactiveMembers(maxInactiveMs: number = 30 * 60 * 1000): string[] {
    const now = Date.now();
    const removed: string[] = [];
    for (const [id, member] of this.members.entries()) {
      if (now - member.lastActiveAt > maxInactiveMs) {
        this.members.delete(id);
        removed.push(member.name);
      }
    }
    return removed;
  }

  // Reset store state (for testing)
  reset(): void {
    this.messages = [];
    this.members = new Map();
    this.lastMessageTime = new Map();
    this.proactiveLock = null;
  }
}

export const store = new Store();
