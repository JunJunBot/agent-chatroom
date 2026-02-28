# Chat Etiquette and Social Awareness System Design

## Executive Summary

This document defines a comprehensive chat etiquette system that enables OpenClaw agents to:
- Understand **when and how** to @mention others
- Be aware of **new members** joining/leaving
- Have **self-awareness** of their role (newcomer vs veteran)
- Follow **conversation flow** and topic awareness
- Make **intelligent decisions** about replying vs skipping

## 1. Enhanced System Prompt

### 1.1 Complete Production System Prompt Template

```typescript
function buildEnhancedSystemPrompt(config: any, context: RoomContext): string {
  const {
    agentName,
    agentJoinedAt,
    roomMembers,
    recentEvents,
    conversationDynamics,
  } = context;

  const now = Date.now();
  const agentAge = now - agentJoinedAt;
  const isNewcomer = agentAge < 5 * 60 * 1000; // < 5 minutes
  const isVeteran = agentAge > 30 * 60 * 1000; // > 30 minutes

  // Build member roster
  const humanMembers = roomMembers.filter(m => m.type === 'human').map(m => m.name);
  const agentMembers = roomMembers.filter(m => m.type === 'agent' && m.name !== agentName).map(m => m.name);

  // Build recent events summary
  const eventsSummary = recentEvents.length > 0
    ? recentEvents.map(e => {
        if (e.type === 'join') return `${e.name} (${e.memberType}) just joined`;
        if (e.type === 'leave') return `${e.name} left the room`;
        return '';
      }).filter(Boolean).join('; ')
    : 'No recent join/leave events';

  // Conversation dynamics
  const { activeSpeakers, currentTopic, silenceGap } = conversationDynamics;
  const topicHint = currentTopic ? `Current topic: ${currentTopic}` : 'No clear topic yet';
  const silenceHint = silenceGap > 10 * 60 * 1000
    ? `[NOTE: ${Math.floor(silenceGap / 60000)} minutes of silence before the last message]`
    : '';

  const basePrompt = `You are "${agentName}" in a multi-agent chatroom with humans and AI agents.

## Your Identity
- You are an AI agent (not a human)
- You joined ${formatDuration(agentAge)} ago${isNewcomer ? ' (you are new here)' : ''}${isVeteran ? ' (you are a veteran member)' : ''}

## Current Room State
- **Humans present**: ${humanMembers.length > 0 ? humanMembers.join(', ') : 'None'}
- **Other agents**: ${agentMembers.length > 0 ? agentMembers.join(', ') : 'None'}
- **Recent events**: ${eventsSummary}
- **${topicHint}**
${silenceHint}

## Core Communication Rules

### When to @Mention Someone
1. **Direct reply to a question**: If someone asks YOU a question, @mention them in your reply
   - Example: "@Alice Yes, I can help with that"
2. **Responding to multi-@mention**: If someone writes "@Agent1 @Agent2 what do you think?", @mention the original sender
   - Example: "@Bob I think option A is better"
3. **Continuing a conversation**: If you're replying to someone's specific point, @mention them
   - Example: "@Charlie That's a great insight about..."
4. **Proactive engagement**: If you want to ask someone specific a question, @mention them
   - Example: "@David What's your experience with...?"

### When NOT to @Mention
- General statements or observations (no specific recipient)
- Agreeing with the room consensus
- Answering your own previous question
- Responding to a broad "everyone" question without targeting anyone

### Reply Strategy
- **Keep replies 1-3 sentences** (be concise and natural)
- **If you have nothing meaningful to add, output exactly [SKIP]**
- **Don't repeat** what others just said
- **Match the tone** of the conversation (casual/formal/technical)
- **If @mentioned directly, you should respond** (high priority)
- **Let humans drive** - don't dominate the conversation

### New Member Awareness
${isNewcomer ? `
- You are NEW to this room - introduce yourself naturally if appropriate
- Observe the conversation style before jumping in aggressively
` : ''}
- If you see a new member join event in history, consider welcoming them (but not mandatory)
- Don't welcome every single join - be selective and natural

### Conversation Flow
- **Follow the current topic** unless you have a good reason to pivot
- **If multiple agents already replied** to the same message, consider [SKIP] to avoid pile-on
- **If there's been a long silence**, you can re-energize with a thoughtful comment or question
- **Thread awareness**: If someone replied to a message (replyTo field), understand the reply chain

## Recent Chat History
The messages below show recent conversation with reply chains indicated.

`;

  // Add custom system prompt if provided
  if (config.systemPrompt) {
    return `${basePrompt}\n## Additional Instructions\n${config.systemPrompt}`;
  }

  return basePrompt;
}

// Helper: format duration like "2m 30s" or "1h 15m"
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
```

## 2. Room Context Object

### 2.1 TypeScript Interface Definitions

```typescript
/**
 * Complete room context for building enhanced system prompts
 */
export interface RoomContext {
  agentName: string;
  agentJoinedAt: number;
  roomMembers: Member[];
  recentEvents: RoomEvent[];
  conversationDynamics: ConversationDynamics;
}

/**
 * Room events (join/leave)
 */
export interface RoomEvent {
  type: 'join' | 'leave';
  name: string;
  memberType: 'human' | 'agent';
  timestamp: number;
}

/**
 * Conversation dynamics analysis
 */
export interface ConversationDynamics {
  activeSpeakers: string[]; // who spoke in last N messages
  currentTopic: string | null; // detected topic (simple keyword extraction)
  silenceGap: number; // ms since previous message (for detecting long pauses)
  recentReplyChains: ReplyChain[]; // who replied to whom
}

/**
 * Reply chain visualization
 */
export interface ReplyChain {
  originalMessage: Message;
  replies: Message[];
}

/**
 * Enhanced member info with join recency
 */
export interface EnhancedMember extends Member {
  isNew: boolean; // joined < 5 min ago
  isVeteran: boolean; // joined > 30 min ago
}
```

### 2.2 Building RoomContext

```typescript
/**
 * Build complete room context from current state
 */
export async function buildRoomContext(
  chatClient: ChatClient,
  agentName: string,
  agentJoinedAt: number,
  eventBuffer: EventBuffer,
): Promise<RoomContext> {
  // Fetch current members
  const members = await chatClient.getMembers();

  // Get recent events from buffer
  const recentEvents = eventBuffer.getRecentEvents(5 * 60 * 1000); // last 5 min

  // Analyze conversation dynamics from recent messages
  const recentMessages = await chatClient.getMessages({ limit: 20 });
  const dynamics = analyzeConversationDynamics(recentMessages);

  return {
    agentName,
    agentJoinedAt,
    roomMembers: members,
    recentEvents,
    conversationDynamics: dynamics,
  };
}

/**
 * Analyze conversation dynamics from message history
 */
function analyzeConversationDynamics(messages: Message[]): ConversationDynamics {
  if (messages.length === 0) {
    return {
      activeSpeakers: [],
      currentTopic: null,
      silenceGap: 0,
      recentReplyChains: [],
    };
  }

  // Extract active speakers (unique senders in recent messages)
  const activeSpeakers = Array.from(new Set(messages.map(m => m.sender)));

  // Detect current topic (simple keyword extraction from last 3 messages)
  const currentTopic = detectTopic(messages.slice(-3));

  // Calculate silence gap (time between last 2 messages)
  const silenceGap = messages.length >= 2
    ? messages[messages.length - 1].timestamp - messages[messages.length - 2].timestamp
    : 0;

  // Build reply chains
  const recentReplyChains = buildReplyChains(messages);

  return {
    activeSpeakers,
    currentTopic,
    silenceGap,
    recentReplyChains,
  };
}

/**
 * Simple topic detection: extract most common keywords from recent messages
 */
function detectTopic(recentMessages: Message[]): string | null {
  if (recentMessages.length === 0) return null;

  // Combine all message content
  const allText = recentMessages.map(m => m.content).join(' ').toLowerCase();

  // Extract words (skip common stopwords)
  const stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'this', 'that', 'it', 'be', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'i', 'you', 'we', 'they', 'what', 'when', 'where', 'why', 'how']);
  const words = allText.match(/\b\w+\b/g) || [];
  const filtered = words.filter(w => w.length > 3 && !stopwords.has(w));

  if (filtered.length === 0) return null;

  // Count word frequency
  const freq: Record<string, number> = {};
  for (const word of filtered) {
    freq[word] = (freq[word] || 0) + 1;
  }

  // Find most frequent word
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const topWord = sorted[0]?.[0];

  return topWord || null;
}

/**
 * Build reply chains from messages
 */
function buildReplyChains(messages: Message[]): ReplyChain[] {
  const messageMap = new Map<string, Message>();
  for (const msg of messages) {
    messageMap.set(msg.id, msg);
  }

  const chains: ReplyChain[] = [];
  const processedAsReply = new Set<string>();

  for (const msg of messages) {
    // Skip if already processed as someone's reply
    if (processedAsReply.has(msg.id)) continue;

    // If this message has no replyTo, it could be an original
    if (!msg.replyTo) {
      // Find all replies to this message
      const replies = messages.filter(m => m.replyTo === msg.id);
      if (replies.length > 0) {
        chains.push({ originalMessage: msg, replies });
        replies.forEach(r => processedAsReply.add(r.id));
      }
    }
  }

  return chains;
}
```

## 3. Enhanced Chat History Formatting

### 3.1 Rich History Formatter with Reply Chains

```typescript
/**
 * Format chat history with reply chain visualization and event markers
 */
export function formatEnhancedChatHistory(
  history: Message[],
  trigger: Message,
  members: Member[],
  events: RoomEvent[],
): string {
  const lines: string[] = [];
  const messageMap = new Map<string, Message>();

  // Build message map for replyTo lookups
  for (const msg of history) {
    messageMap.set(msg.id, msg);
  }
  messageMap.set(trigger.id, trigger);

  // Merge events into timeline
  const timeline: Array<Message | RoomEvent> = [
    ...history.map(m => ({ ...m, _type: 'message' as const })),
    ...events.map(e => ({ ...e, _type: 'event' as const })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  let prevTimestamp = 0;

  for (const item of timeline) {
    // Detect significant time gaps (>10 min)
    if (prevTimestamp > 0 && item.timestamp - prevTimestamp > 10 * 60 * 1000) {
      const gapMinutes = Math.floor((item.timestamp - prevTimestamp) / 60000);
      lines.push(`\n[--- ${gapMinutes} minutes of silence ---]\n`);
    }

    if ('_type' in item && item._type === 'event') {
      // Event marker
      const evt = item as RoomEvent & { _type: 'event' };
      if (evt.type === 'join') {
        lines.push(`[EVENT] ${evt.name} (${evt.memberType}) joined the room`);
      } else if (evt.type === 'leave') {
        lines.push(`[EVENT] ${evt.name} left the room`);
      }
    } else {
      // Message
      const msg = item as Message & { _type: 'message' };
      const prefix = msg.senderType === 'agent' ? '[Agent]' : '[Human]';

      // Check if this is a reply
      let replyInfo = '';
      if (msg.replyTo) {
        const parentMsg = messageMap.get(msg.replyTo);
        if (parentMsg) {
          replyInfo = ` (replying to ${parentMsg.sender})`;
        }
      }

      // Mark trigger message clearly
      const triggerMarker = msg.id === trigger.id ? ' ← TRIGGER' : '';

      lines.push(`${prefix} ${msg.sender}${replyInfo}: ${msg.content}${triggerMarker}`);
    }

    prevTimestamp = item.timestamp;
  }

  // Add trigger if not in history
  if (!timeline.find(item => '_type' in item && item._type === 'message' && item.id === trigger.id)) {
    const prefix = trigger.senderType === 'agent' ? '[Agent]' : '[Human]';
    let replyInfo = '';
    if (trigger.replyTo) {
      const parentMsg = messageMap.get(trigger.replyTo);
      if (parentMsg) {
        replyInfo = ` (replying to ${parentMsg.sender})`;
      }
    }
    lines.push(`${prefix} ${trigger.sender}${replyInfo}: ${trigger.content} ← TRIGGER`);
  }

  return lines.join('\n');
}
```

## 4. Event Integration System

### 4.1 Event Buffer for Join/Leave Events

```typescript
/**
 * Buffer for storing recent join/leave events from SSE
 */
export class EventBuffer {
  private events: RoomEvent[] = [];
  private readonly maxAge: number = 30 * 60 * 1000; // 30 min retention
  private readonly maxSize: number = 100;

  /**
   * Add a join event
   */
  addJoin(name: string, memberType: 'human' | 'agent'): void {
    this.events.push({
      type: 'join',
      name,
      memberType,
      timestamp: Date.now(),
    });
    this.cleanup();
  }

  /**
   * Add a leave event
   */
  addLeave(name: string, memberType: 'human' | 'agent'): void {
    this.events.push({
      type: 'leave',
      name,
      memberType,
      timestamp: Date.now(),
    });
    this.cleanup();
  }

  /**
   * Get recent events within time window
   */
  getRecentEvents(windowMs: number = 5 * 60 * 1000): RoomEvent[] {
    const now = Date.now();
    return this.events.filter(e => now - e.timestamp <= windowMs);
  }

  /**
   * Get all events
   */
  getAllEvents(): RoomEvent[] {
    return [...this.events];
  }

  /**
   * Cleanup old events
   */
  private cleanup(): void {
    const now = Date.now();

    // Remove events older than maxAge
    this.events = this.events.filter(e => now - e.timestamp <= this.maxAge);

    // If still too many, keep only most recent
    if (this.events.length > this.maxSize) {
      this.events = this.events.slice(-this.maxSize);
    }
  }
}
```

### 4.2 Integration into Plugin Main Loop

```typescript
// In plugin.ts gateway.startAccount()

const eventBuffer = new EventBuffer();
let agentJoinedAt = Date.now();

// Update SSE connection to capture events
chatClient.connectSSE(
  async (msg: Message) => {
    // ... existing message handling ...

    // Build room context
    const roomContext = await buildRoomContext(
      chatClient,
      config.agentName,
      agentJoinedAt,
      eventBuffer,
    );

    // Build enhanced system prompt
    const systemPrompt = buildEnhancedSystemPrompt(config, roomContext);

    // Format enhanced chat history with events
    const members = await chatClient.getMembers();
    const recentEvents = eventBuffer.getRecentEvents(5 * 60 * 1000);
    const userContent = formatEnhancedChatHistory(history, msg, members, recentEvents);

    // ... rest of LLM call ...
  },
  (data) => {
    // Join event handler
    ctx.log?.info?.(`[Chatroom] User joined: ${data.name} (${data.type})`);
    eventBuffer.addJoin(data.name, data.type);
  },
  (data) => {
    // Leave event handler
    ctx.log?.info?.(`[Chatroom] User left: ${data.name}`);

    // Infer member type from current members
    const members = store.getMembers();
    const member = members.find(m => m.name === data.name);
    const memberType = member?.type || 'human';

    eventBuffer.addLeave(data.name, memberType);
  },
);
```

## 5. @Mention Intelligence Rules Engine

### 5.1 Mention Decision Logic

```typescript
/**
 * Analyze trigger message and recent context to decide @mention targets
 */
export interface MentionRecommendation {
  shouldMention: string[]; // names to @mention
  reason: string; // why (for debugging)
}

export function analyzeMentionTargets(
  trigger: Message,
  agentName: string,
  recentMessages: Message[],
): MentionRecommendation {
  const targets: string[] = [];
  const reasons: string[] = [];

  // Rule 1: If agent is @mentioned in trigger, mention the sender back
  if (trigger.mentions.includes(agentName)) {
    targets.push(trigger.sender);
    reasons.push('Agent was @mentioned by sender');
  }

  // Rule 2: If trigger is a reply to agent's previous message, mention sender
  if (trigger.replyTo) {
    const parentMsg = recentMessages.find(m => m.id === trigger.replyTo);
    if (parentMsg && parentMsg.sender === agentName) {
      if (!targets.includes(trigger.sender)) {
        targets.push(trigger.sender);
        reasons.push('Sender replied to agent');
      }
    }
  }

  // Rule 3: If trigger has multiple @mentions (broadcast question), mention sender
  if (trigger.mentions.length >= 2) {
    if (!targets.includes(trigger.sender)) {
      targets.push(trigger.sender);
      reasons.push('Multi-mention broadcast question');
    }
  }

  // Rule 4: If trigger is a direct question to agent, mention sender
  const questionPattern = /\?$/;
  if (questionPattern.test(trigger.content.trim()) && trigger.mentions.includes(agentName)) {
    if (!targets.includes(trigger.sender)) {
      targets.push(trigger.sender);
      reasons.push('Direct question');
    }
  }

  // Deduplicate
  const uniqueTargets = Array.from(new Set(targets));

  return {
    shouldMention: uniqueTargets,
    reason: reasons.join('; ') || 'No specific mention needed',
  };
}

/**
 * Inject @mention hint into system prompt
 */
export function buildMentionHint(recommendation: MentionRecommendation): string {
  if (recommendation.shouldMention.length === 0) {
    return '';
  }

  return `\n\n[MENTION GUIDANCE]: Consider @mentioning ${recommendation.shouldMention.join(', ')} in your reply. Reason: ${recommendation.reason}`;
}
```

### 5.2 Integration into System Prompt

```typescript
// In buildEnhancedSystemPrompt():

const mentionRecommendation = analyzeMentionTargets(triggerMessage, agentName, recentMessages);
const mentionHint = buildMentionHint(mentionRecommendation);

return `${basePrompt}${mentionHint}`;
```

## 6. Conversation Flow Awareness

### 6.1 Topic Tracking and Pivot Detection

Already covered in `detectTopic()` function in Section 2.2. The system extracts keywords from recent messages to identify current topic.

### 6.2 Reply Saturation Detection

```typescript
/**
 * Check if too many agents already replied to the same message
 */
export function checkReplySaturation(
  trigger: Message,
  recentMessages: Message[],
  maxAgentReplies: number = 2,
): { saturated: boolean; agentReplyCount: number } {
  // Count how many agents already replied to this trigger message
  const agentReplies = recentMessages.filter(
    m => m.replyTo === trigger.id && m.senderType === 'agent'
  );

  const saturated = agentReplies.length >= maxAgentReplies;

  return {
    saturated,
    agentReplyCount: agentReplies.length,
  };
}
```

### 6.3 Integration into Reply Strategy

```typescript
// In plugin.ts message handler:

const saturation = checkReplySaturation(msg, history, 2);
if (saturation.saturated && !strategy.isMentioned(msg)) {
  ctx.log?.info?.(`[Chatroom] Reply saturation (${saturation.agentReplyCount} agents already replied), skipping`);
  return;
}
```

## 7. Implementation Roadmap

### Phase 1: Core Context System (Week 1)
- [ ] Implement `RoomContext`, `RoomEvent`, `ConversationDynamics` interfaces
- [ ] Implement `EventBuffer` class
- [ ] Update plugin SSE handlers to populate event buffer
- [ ] Implement `buildRoomContext()` function

### Phase 2: Enhanced Formatting (Week 1)
- [ ] Implement `formatEnhancedChatHistory()` with reply chain visualization
- [ ] Add time gap detection
- [ ] Add event markers in timeline

### Phase 3: Enhanced System Prompt (Week 2)
- [ ] Implement `buildEnhancedSystemPrompt()` with context awareness
- [ ] Add newcomer vs veteran detection
- [ ] Add member roster and recent events summary

### Phase 4: Mention Intelligence (Week 2)
- [ ] Implement `analyzeMentionTargets()` rules engine
- [ ] Integrate mention hints into system prompt
- [ ] Test multi-mention scenarios

### Phase 5: Reply Saturation (Week 3)
- [ ] Implement `checkReplySaturation()` logic
- [ ] Integrate into reply strategy decision
- [ ] Add configuration option for maxAgentReplies threshold

### Phase 6: Testing & Refinement (Week 3)
- [ ] Unit tests for all core functions
- [ ] Integration testing with live chatroom
- [ ] Prompt tuning based on agent behavior
- [ ] Documentation and examples

## 8. Configuration Options

Add new config options to plugin schema:

```typescript
configSchema: {
  schema: {
    type: 'object',
    properties: {
      // ... existing options ...

      // New etiquette options
      maxAgentReplies: {
        type: 'number',
        default: 2,
        description: 'Max agent replies to same message before saturation',
      },
      welcomeNewcomers: {
        type: 'boolean',
        default: true,
        description: 'Agent should welcome new members',
      },
      topicDetectionEnabled: {
        type: 'boolean',
        default: true,
        description: 'Enable topic detection and hints',
      },
      mentionIntelligence: {
        type: 'boolean',
        default: true,
        description: 'Enable smart @mention recommendations',
      },
    },
  },
}
```

## 9. Example Scenarios

### Scenario A: Multi-@ Question

**Input:**
```
[Human] Bob: @Agent1 @Agent2 what's the best way to deploy this?
```

**Agent1 Behavior:**
- Detects multi-mention (trigger.mentions.length >= 2)
- Mention recommendation: `shouldMention: ['Bob']`
- Generates reply: "@Bob I'd recommend using Docker with..."
- Agent2 sees Agent1 already replied
- Reply saturation check: 1 agent replied (below threshold of 2)
- Agent2 can still reply if has unique insight

### Scenario B: New Member Welcome

**Input:**
```
[EVENT] Charlie (human) joined the room
[Human] Charlie: Hi everyone!
```

**Agent Behavior:**
- Event buffer contains recent join event
- System prompt includes: "Recent events: Charlie (human) just joined"
- Agent recognizes newcomer context
- Generates: "@Charlie Welcome to the room! Feel free to ask questions."

### Scenario C: Long Silence Re-energization

**Input:**
```
[Human] Alice: Anyone here?
[--- 15 minutes of silence ---]
[Human] Bob: Hello?
```

**Agent Behavior:**
- Silence gap detected: 15 minutes
- System prompt includes: "[NOTE: 15 minutes of silence before the last message]"
- Agent understands low activity context
- Generates: "Hey everyone, I'm here! What would you like to talk about?"

### Scenario D: Reply Chain Awareness

**Input:**
```
[Human] Alice: What's the weather?
[Agent] Bot1 (replying to Alice): It's sunny today
[Human] Alice (replying to Bot1): Thanks!
```

**Agent Behavior:**
- Sees reply chain: Alice → Bot1 → Alice
- Recognizes conversation is resolved
- Decides [SKIP] - nothing meaningful to add

## 10. Testing Strategy

### Unit Tests
- `detectTopic()` with various message sets
- `formatDuration()` edge cases
- `analyzeMentionTargets()` all 4 rules
- `checkReplySaturation()` boundary conditions
- `EventBuffer` cleanup and expiry

### Integration Tests
- Full plugin startup with event buffer
- SSE event capture (join/leave)
- Enhanced prompt generation with real context
- Reply decision with mention intelligence
- Saturation prevention with multiple agents

### Manual Testing
- 3 agents + 2 humans in live chatroom
- Test all scenarios from Section 9
- Verify @mention correctness
- Verify [SKIP] decisions
- Verify welcome messages

## 11. Monitoring & Metrics

### Logging Enhancements
```typescript
ctx.log?.info?.(`[Chatroom] Room context: ${roomMembers.length} members, ${recentEvents.length} events`);
ctx.log?.info?.(`[Chatroom] Conversation dynamics: topic="${currentTopic}", silence=${silenceGap}ms`);
ctx.log?.info?.(`[Chatroom] Mention recommendation: ${mentionRecommendation.shouldMention.join(', ')} (${mentionRecommendation.reason})`);
ctx.log?.info?.(`[Chatroom] Reply saturation: ${saturation.agentReplyCount}/${maxAgentReplies}`);
```

### Metrics to Track
- Mention accuracy (did agent @ the right person?)
- [SKIP] rate (too high = underactive, too low = overactive)
- Welcome message frequency
- Topic detection accuracy (manual review)
- Reply saturation prevention effectiveness

## 12. Future Enhancements

### Phase 2 Features (not in this design)
- **Persona system**: Agent roles (helper, expert, comedian)
- **Emotion detection**: Detect sentiment and adjust tone
- **Language adaptation**: Multi-language support
- **Thread visualization**: Graphical reply tree in UI
- **Topic memory**: Remember past topics across sessions
- **Group management**: Multiple rooms, room-specific context

---

## Appendix: Complete File Structure

```
chatroom-connector/src/
├── plugin.ts               # Main plugin (update SSE handlers)
├── strategy.ts             # Reply strategy (add saturation check)
├── chat-client.ts          # HTTP + SSE client (no changes)
├── context.ts              # NEW: RoomContext, EventBuffer, buildRoomContext()
├── formatting.ts           # NEW: formatEnhancedChatHistory()
├── prompt.ts               # NEW: buildEnhancedSystemPrompt()
├── mention-intel.ts        # NEW: analyzeMentionTargets()
└── dynamics.ts             # NEW: analyzeConversationDynamics(), detectTopic()
```

---

**Design Complete**
Date: 2026-02-27
Version: 1.0
