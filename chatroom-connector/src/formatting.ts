/**
 * Enhanced chat history formatting with context awareness
 */

import type { Message } from './chat-client.js';
import type { RoomContext } from './context.js';

/**
 * Format chat history with enhanced features
 */
export function formatChatHistory(
  history: Message[],
  trigger: Message,
  context?: RoomContext,
): string {
  const lines: string[] = [];
  let lastTimestamp = 0;

  // Sort messages by timestamp
  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);

  // Add trigger if not in history
  if (!sorted.find(m => m.id === trigger.id)) {
    sorted.push(trigger);
  }

  for (const msg of sorted) {
    // Check for time gap
    if (lastTimestamp > 0 && msg.timestamp - lastTimestamp > 5 * 60 * 1000) {
      lines.push('[5+ minutes of silence]');
    }

    // Insert system events if within time range
    if (context?.recentEvents) {
      for (const event of context.recentEvents) {
        if (event.timestamp > lastTimestamp && event.timestamp <= msg.timestamp) {
          lines.push(`[SYSTEM] ${event.name} ${event.type} the room`);
        }
      }
    }

    // Build message line
    const prefix = msg.senderType === 'agent' ? '[Agent]' : '[Human]';
    let content = msg.content;

    // Truncate long messages
    if (content.length > 300) {
      content = content.substring(0, 300) + '...';
    }

    // Check for reply chain
    let replyNote = '';
    if (msg.replyTo) {
      const repliedMsg = sorted.find(m => m.id === msg.replyTo);
      if (repliedMsg) {
        replyNote = ` (replying to ${repliedMsg.sender})`;
      }
    }

    // Highlight mentions of the agent
    if (context && msg.mentions.includes(context.myName)) {
      content = `>>> ${content} <<<`;
    }

    lines.push(`${prefix} ${msg.sender}${replyNote}: ${content}`);
    lastTimestamp = msg.timestamp;
  }

  return lines.join('\n');
}
