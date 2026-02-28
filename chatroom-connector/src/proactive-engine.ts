/**
 * Proactive speaking engine for idle room engagement
 */

import type { Message } from './chat-client.js';

export interface ProactiveConfig {
  serverUrl: string;
  agentName: string;
  checkInterval?: number; // default 30000 (30s)
  minIdleTime?: number; // default 60000 (60s)
  cooldown?: number; // default 300000 (5min)
  maxDailyPerAgent?: number; // default 20
  maxDailyGlobal?: number; // default 50
  enabled?: boolean; // default false
  onSpeak: (content: string) => Promise<void>;
  onGenerateTopic: () => Promise<string>;
  log?: any;
}

export class ProactiveEngine {
  private config: ProactiveConfig;
  private timer: NodeJS.Timeout | null = null;
  private dailyCount: number = 0;
  private lastProactiveTime: number = 0;
  private consecutiveNoReply: number = 0;
  private lastDailyReset: string = '';

  constructor(config: ProactiveConfig) {
    this.config = {
      checkInterval: 30000,
      minIdleTime: 60000,
      cooldown: 300000,
      maxDailyPerAgent: 20,
      maxDailyGlobal: 50,
      enabled: false,
      ...config,
    };
  }

  /**
   * Start the proactive engine
   */
  start(): void {
    if (!this.config.enabled) {
      this.config.log?.info?.('[ProactiveEngine] Not enabled, skipping start');
      return;
    }

    if (this.timer) {
      this.config.log?.warn?.('[ProactiveEngine] Already started');
      return;
    }

    this.config.log?.info?.('[ProactiveEngine] Starting...');
    this.timer = setInterval(() => {
      this.checkAndSpeak().catch(err => {
        this.config.log?.error?.(`[ProactiveEngine] Error: ${err.message}`);
      });
    }, this.config.checkInterval);
  }

  /**
   * Stop the proactive engine
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.config.log?.info?.('[ProactiveEngine] Stopped');
    }
  }

  /**
   * Check if should speak and generate topic
   */
  private async checkAndSpeak(): Promise<void> {
    // Reset daily count at midnight
    const today = new Date().toDateString();
    if (this.lastDailyReset !== today) {
      this.dailyCount = 0;
      this.lastDailyReset = today;
      this.config.log?.info?.('[ProactiveEngine] Daily count reset');
    }

    // Check daily limit
    if (this.dailyCount >= this.config.maxDailyPerAgent!) {
      this.config.log?.debug?.('[ProactiveEngine] Daily limit reached, skipping');
      return;
    }

    // Check cooldown with engagement backoff
    const currentCooldown = this.getCurrentCooldown();
    const timeSinceLastProactive = Date.now() - this.lastProactiveTime;
    if (timeSinceLastProactive < currentCooldown) {
      this.config.log?.debug?.(
        `[ProactiveEngine] In cooldown, ${Math.round((currentCooldown - timeSinceLastProactive) / 1000)}s remaining`
      );
      return;
    }

    // Check if room is idle
    try {
      const activity = await this.fetchActivity();
      if (!activity.isIdle) {
        this.config.log?.debug?.('[ProactiveEngine] Room is not idle, skipping');
        return;
      }
    } catch (err: any) {
      this.config.log?.error?.(`[ProactiveEngine] Failed to fetch activity: ${err.message}`);
      return;
    }

    // Request turn
    try {
      const turnResult = await this.requestTurn();
      if (!turnResult.granted) {
        this.config.log?.debug?.('[ProactiveEngine] Turn not granted, skipping');
        return;
      }
    } catch (err: any) {
      this.config.log?.error?.(`[ProactiveEngine] Failed to request turn: ${err.message}`);
      return;
    }

    // Generate topic and speak
    try {
      const topic = await this.config.onGenerateTopic();
      if (!topic || topic.includes('[SKIP]')) {
        this.config.log?.info?.('[ProactiveEngine] No topic generated, skipping');
        return;
      }

      await this.config.onSpeak(topic);
      this.dailyCount++;
      this.lastProactiveTime = Date.now();
      this.config.log?.info?.(`[ProactiveEngine] Spoke proactively: ${topic.substring(0, 50)}...`);
    } catch (err: any) {
      this.config.log?.error?.(`[ProactiveEngine] Failed to speak: ${err.message}`);
    }
  }

  /**
   * Fetch activity status from server
   */
  private async fetchActivity(): Promise<{ isIdle: boolean; lastMessageTime: number }> {
    // This will be implemented by chat-client
    // For now, return mock data
    const axios = (await import('axios')).default;
    const response = await axios.get(`${this.config.serverUrl}/activity`, {
      timeout: 5000,
    });
    return response.data;
  }

  /**
   * Request proactive turn from server
   */
  private async requestTurn(): Promise<{ granted: boolean; lockUntil?: number }> {
    const axios = (await import('axios')).default;
    const response = await axios.post(
      `${this.config.serverUrl}/proactive/request-turn`,
      { agentName: this.config.agentName },
      { timeout: 5000 }
    );
    return response.data;
  }

  /**
   * Check engagement from recent messages
   */
  checkEngagement(recentMessages: Message[]): void {
    if (this.lastProactiveTime === 0) return;

    // Check if any messages appeared after last proactive
    const repliesAfterProactive = recentMessages.filter(
      m => m.timestamp > this.lastProactiveTime && m.sender !== this.config.agentName
    );

    if (repliesAfterProactive.length === 0) {
      this.consecutiveNoReply++;
      this.config.log?.info?.(`[ProactiveEngine] No engagement, consecutive: ${this.consecutiveNoReply}`);
    } else {
      this.consecutiveNoReply = 0;
      this.config.log?.info?.('[ProactiveEngine] Engagement detected, backoff reset');
    }
  }

  /**
   * Get current cooldown with engagement backoff
   */
  getCurrentCooldown(): number {
    const baseCooldown = this.config.cooldown!;
    const backoffMultiplier = Math.pow(2, this.consecutiveNoReply);
    const maxCooldown = 30 * 60 * 1000; // 30 minutes
    return Math.min(baseCooldown * backoffMultiplier, maxCooldown);
  }
}
