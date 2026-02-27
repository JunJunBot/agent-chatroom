/**
 * Reply decision logic
 */

import type { Message } from './chat-client';

export interface StrategyConfig {
  agentName: string;
  replyProbability: number;
  mentionAlwaysReply: boolean;
  cooldownMin: number;
  cooldownMax: number;
}

export class ReplyStrategy {
  private config: StrategyConfig;
  private lastReplyTime: number = 0;
  private currentCooldown: number = 0;

  constructor(config: StrategyConfig) {
    this.config = config;
  }

  /**
   * Check if @mentioned in the message
   */
  isMentioned(msg: Message): boolean {
    return msg.mentions.some(
      (mention) => mention.toLowerCase() === this.config.agentName.toLowerCase(),
    );
  }

  /**
   * Check if in cooldown period
   */
  isInCooldown(): boolean {
    const now = Date.now();
    return now - this.lastReplyTime < this.currentCooldown;
  }

  /**
   * Start a new cooldown period
   */
  startCooldown(): void {
    this.lastReplyTime = Date.now();
    // Random cooldown between min and max
    const range = this.config.cooldownMax - this.config.cooldownMin;
    this.currentCooldown = this.config.cooldownMin + Math.random() * range;
  }

  /**
   * Decide if should reply to this message
   */
  shouldReply(msg: Message): boolean {
    // Ignore own messages
    if (msg.sender === this.config.agentName) {
      return false;
    }

    // Always reply if @-mentioned (bypasses cooldown)
    if (this.config.mentionAlwaysReply && this.isMentioned(msg)) {
      return true;
    }

    // Check cooldown
    if (this.isInCooldown()) {
      return false;
    }

    // Random probability
    return Math.random() < this.config.replyProbability;
  }

  /**
   * Get time remaining in cooldown (ms)
   */
  getCooldownRemaining(): number {
    const now = Date.now();
    const remaining = this.currentCooldown - (now - this.lastReplyTime);
    return Math.max(0, remaining);
  }
}
