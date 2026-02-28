/**
 * Context compression for token budget management
 */

import type { Message } from './chat-client.js';

export interface CompressOptions {
  strategy?: 'recent' | 'important' | 'hybrid';
  maxTokens?: number;
  agentName: string;
}

/**
 * Estimate token count for text (CJK vs non-CJK)
 */
export function estimateTokens(text: string): number {
  // CJK character ranges
  const cjkRanges = [
    [0x4e00, 0x9fff], // CJK Unified Ideographs
    [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
    [0x3000, 0x303f], // CJK Symbols and Punctuation
    [0xff00, 0xffef], // Halfwidth and Fullwidth Forms
  ];

  let cjkChars = 0;
  let nonCjkChars = 0;

  for (const char of text) {
    const code = char.charCodeAt(0);
    const isCjk = cjkRanges.some(([start, end]) => code >= start && code <= end);
    if (isCjk) {
      cjkChars++;
    } else {
      nonCjkChars++;
    }
  }

  // CJK: ~2 chars per token (0.5 tokens per char)
  // Non-CJK: ~4 chars per token (0.25 tokens per char)
  const cjkTokens = cjkChars / 2;
  const nonCjkTokens = nonCjkChars / 4;

  return Math.ceil(cjkTokens + nonCjkTokens);
}

/**
 * Trace reply chain from a target message
 */
export function traceReplyChain(
  targetId: string,
  messages: Message[],
  maxDepth: number = 5,
): Message[] {
  const chain: Message[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = targetId;
  let depth = 0;

  while (currentId && depth < maxDepth) {
    // Cycle detection
    if (visited.has(currentId)) {
      break;
    }
    visited.add(currentId);

    const msg = messages.find(m => m.id === currentId);
    if (!msg) break;

    chain.push(msg);
    currentId = msg.replyTo;
    depth++;
  }

  // Return in chronological order (oldest first)
  return chain.reverse();
}

/**
 * Calculate importance score for a message
 */
export function calculateImportance(msg: Message, agentName: string): number {
  let score = 0.3; // base score

  // Mentions the agent
  if (msg.mentions.includes(agentName)) {
    score += 0.3;
  }

  // Is a question
  if (msg.content.includes('?') || msg.content.includes('?')) {
    score += 0.2;
  }

  // Has reply chain
  if (msg.replyTo) {
    score += 0.1;
  }

  // Note: New member detection is simplified here
  // In real usage, we'd need member join time info
  // For now, we skip this factor or check via external context

  return Math.min(1.0, score);
}

/**
 * Compress context to fit within token budget
 */
export function compressContext(
  messages: Message[],
  trigger: Message,
  options?: CompressOptions,
): Message[] {
  const strategy = options?.strategy || 'hybrid';
  const maxTokens = options?.maxTokens || 2000;
  const agentName = options?.agentName || '';

  if (strategy === 'recent') {
    return compressRecent(messages, trigger, maxTokens);
  } else if (strategy === 'important') {
    return compressImportant(messages, trigger, maxTokens, agentName);
  } else {
    return compressHybrid(messages, trigger, maxTokens, agentName);
  }
}

/**
 * Recent strategy: sliding window from end
 */
function compressRecent(messages: Message[], trigger: Message, maxTokens: number): Message[] {
  const selected: Message[] = [];
  let tokenCount = 0;

  // Include trigger first
  const triggerTokens = estimateTokens(trigger.content);
  if (triggerTokens <= maxTokens) {
    selected.push(trigger);
    tokenCount += triggerTokens;
  }

  // Add messages from end
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.id === trigger.id) continue;

    const msgTokens = estimateTokens(msg.content);
    if (tokenCount + msgTokens > maxTokens) break;

    selected.unshift(msg);
    tokenCount += msgTokens;
  }

  return selected.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Important strategy: greedy by importance score
 */
function compressImportant(
  messages: Message[],
  trigger: Message,
  maxTokens: number,
  agentName: string,
): Message[] {
  // Score all messages
  const scored = messages
    .map(msg => ({
      msg,
      score: calculateImportance(msg, agentName),
      tokens: estimateTokens(msg.content),
    }))
    .sort((a, b) => b.score - a.score);

  const selected: Message[] = [];
  let tokenCount = 0;

  // Greedy selection
  for (const { msg, tokens } of scored) {
    if (msg.id === trigger.id) continue;
    if (tokenCount + tokens > maxTokens) continue;

    selected.push(msg);
    tokenCount += tokens;
  }

  // Add trigger
  const triggerTokens = estimateTokens(trigger.content);
  if (tokenCount + triggerTokens <= maxTokens) {
    selected.push(trigger);
  }

  // Re-sort by timestamp
  return selected.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Hybrid strategy: P1 reply chain + P2 mentions + P3 importance
 */
function compressHybrid(
  messages: Message[],
  trigger: Message,
  maxTokens: number,
  agentName: string,
): Message[] {
  const selected = new Set<Message>();
  let tokenCount = 0;

  // P1: Reply chain of trigger
  const chain = traceReplyChain(trigger.id, messages);
  for (const msg of chain) {
    const tokens = estimateTokens(msg.content);
    if (tokenCount + tokens <= maxTokens) {
      selected.add(msg);
      tokenCount += tokens;
    }
  }

  // P2: Messages mentioning agent in last 5 minutes
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const mentions = messages.filter(
    m => m.timestamp >= fiveMinAgo && m.mentions.includes(agentName) && !selected.has(m)
  );
  for (const msg of mentions) {
    const tokens = estimateTokens(msg.content);
    if (tokenCount + tokens <= maxTokens) {
      selected.add(msg);
      tokenCount += tokens;
    }
  }

  // P3: Fill remaining budget with important messages
  const remaining = messages
    .filter(m => !selected.has(m))
    .map(msg => ({
      msg,
      score: calculateImportance(msg, agentName),
      tokens: estimateTokens(msg.content),
    }))
    .sort((a, b) => b.score - a.score);

  for (const { msg, tokens } of remaining) {
    if (tokenCount + tokens > maxTokens) continue;
    selected.add(msg);
    tokenCount += tokens;
  }

  // Sort by timestamp
  return Array.from(selected).sort((a, b) => a.timestamp - b.timestamp);
}
