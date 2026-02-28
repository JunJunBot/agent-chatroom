/**
 * Mention intelligence for smart reply decisions
 */

import type { Message } from './chat-client.js';
import type { RoomContext } from './context.js';

export interface RespondDecision {
  respond: boolean;
  reason: string;
  replyTo?: string;
}

export class MentionIntelligence {
  private agentName: string;

  constructor(agentName: string) {
    this.agentName = agentName;
  }

  /**
   * Decide whether to respond to a message based on intelligent analysis
   */
  shouldRespond(
    msg: Message,
    context: RoomContext,
    recentMessages: Message[],
  ): RespondDecision {
    // 1. Direct mention - always respond
    if (msg.mentions.includes(this.agentName)) {
      return {
        respond: true,
        reason: 'directly_mentioned',
        replyTo: msg.id,
      };
    }

    // 2. Reply saturation - too many agents already replied
    const agentReplyCount = this.getAgentReplyCount(msg.id, recentMessages);
    if (agentReplyCount >= 2) {
      return {
        respond: false,
        reason: 'reply_saturation',
      };
    }

    // 3. Ongoing thread - don't interrupt if not a participant
    if (context.conversationDynamics.ongoingThread) {
      const { participants } = context.conversationDynamics.ongoingThread;
      if (!participants.includes(this.agentName)) {
        return {
          respond: false,
          reason: 'ongoing_thread',
        };
      }
    }

    // 4. New member greeting - welcome new members
    const senderInfo = context.memberList.find(m => m.name === msg.sender);
    if (senderInfo?.isNew) {
      // Check if this is their first message
      const senderMessages = recentMessages.filter(m => m.sender === msg.sender);
      if (senderMessages.length <= 1) {
        return {
          respond: true,
          reason: 'new_member_greeting',
          replyTo: msg.id,
        };
      }
    }

    // 5. General - allow response
    return {
      respond: true,
      reason: 'general',
    };
  }

  /**
   * Count how many agents have replied to a specific message
   */
  getAgentReplyCount(messageId: string, messages: Message[]): number {
    return messages.filter(
      m => m.replyTo === messageId && m.senderType === 'agent'
    ).length;
  }
}
