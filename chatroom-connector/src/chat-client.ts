/**
 * HTTP + SSE client for chatroom-server
 */

import axios from 'axios';
import EventSource from 'eventsource';

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

export interface JoinResponse {
  success: boolean;
  member?: Member;
  error?: string;
}

export interface MessageResponse {
  success: boolean;
  message?: Message;
  error?: string;
}

export interface ChatClientConfig {
  serverUrl: string;
  agentName: string;
  log?: any;
}

// ============ Message Deduplication ============

/** Message deduplication cache Map<messageId, timestamp> - prevent duplicate processing */
const processedMessages = new Map<string, number>();

/** Message deduplication cache expiry time (5 minutes) */
const MESSAGE_DEDUP_TTL = 5 * 60 * 1000;

/** Clean up expired message deduplication cache */
function cleanupProcessedMessages(): void {
  const now = Date.now();
  for (const [msgId, timestamp] of processedMessages.entries()) {
    if (now - timestamp > MESSAGE_DEDUP_TTL) {
      processedMessages.delete(msgId);
    }
  }
}

/** Check if message has been processed (deduplication) */
function isMessageProcessed(messageId: string): boolean {
  if (!messageId) return false;
  return processedMessages.has(messageId);
}

/** Mark message as processed */
function markMessageProcessed(messageId: string): void {
  if (!messageId) return;
  processedMessages.set(messageId, Date.now());
  // Periodic cleanup (every 100 messages)
  if (processedMessages.size >= 100) {
    cleanupProcessedMessages();
  }
}

export class ChatClient {
  private config: ChatClientConfig;
  private eventSource?: EventSource;
  private reconnectAttempts: number = 0;
  private maxReconnectDelay: number = 30000; // 30 seconds
  private reconnectTimer?: NodeJS.Timeout;
  private shouldReconnect: boolean = true;
  private messageHandler?: (msg: Message) => void;
  private joinHandler?: (data: any) => void;
  private leaveHandler?: (data: any) => void;
  private lastMessageTimestamp: number = 0;

  constructor(config: ChatClientConfig) {
    this.config = config;
  }

  /**
   * Join the chatroom
   */
  async join(name: string, type: 'human' | 'agent'): Promise<JoinResponse> {
    try {
      const response = await axios.post(`${this.config.serverUrl}/join`, {
        name,
        type,
      });
      this.config.log?.info?.(`[ChatClient] Joined room as ${name}`);
      return { success: true, member: response.data };
    } catch (error: any) {
      this.config.log?.error?.(`[ChatClient] Failed to join: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get messages since a timestamp
   */
  async getMessages(params: { since?: number; limit?: number } = {}): Promise<Message[]> {
    try {
      const response = await axios.get(`${this.config.serverUrl}/messages`, {
        params: {
          since: params.since || 0,
          limit: params.limit || 20,
        },
      });
      return response.data;
    } catch (error: any) {
      this.config.log?.error?.(`[ChatClient] Failed to get messages: ${error.message}`);
      return [];
    }
  }

  /**
   * Get members list
   */
  async getMembers(): Promise<Member[]> {
    try {
      const response = await axios.get(`${this.config.serverUrl}/members`);
      return response.data;
    } catch (error: any) {
      this.config.log?.error?.(`[ChatClient] Failed to get members: ${error.message}`);
      return [];
    }
  }

  /**
   * Send a message
   */
  async sendMessage(
    sender: string,
    content: string,
    replyTo?: string,
    isMentionReply?: boolean,
  ): Promise<MessageResponse> {
    const sendRequest = async () => {
      try {
        const response = await axios.post(`${this.config.serverUrl}/messages`, {
          sender,
          content,
          replyTo,
          isMentionReply,
        });
        this.config.log?.info?.(`[ChatClient] Message sent: ${content.substring(0, 50)}...`);
        return { success: true, message: response.data };
      } catch (error: any) {
        // Handle 429 rate limit
        if (error.response?.status === 429) {
          const retryAfter = error.response?.data?.retryAfter || 5000;
          this.config.log?.warn?.(`[ChatClient] Rate limited, retrying after ${retryAfter}ms`);

          // Wait and retry once
          await new Promise(resolve => setTimeout(resolve, retryAfter));

          try {
            const retryResponse = await axios.post(`${this.config.serverUrl}/messages`, {
              sender,
              content,
              replyTo,
              isMentionReply,
            });
            this.config.log?.info?.(`[ChatClient] Message sent (retry): ${content.substring(0, 50)}...`);
            return { success: true, message: retryResponse.data };
          } catch (retryError: any) {
            this.config.log?.error?.(`[ChatClient] Retry failed: ${retryError.message}`);
            return { success: false, error: retryError.message };
          }
        }

        this.config.log?.error?.(`[ChatClient] Failed to send message: ${error.message}`);
        return { success: false, error: error.message };
      }
    };

    return sendRequest();
  }

  /**
   * Connect to SSE stream with automatic reconnection
   * Node.js eventsource library does NOT auto-reconnect, so we implement exponential backoff
   */
  connectSSE(
    onMessage: (msg: Message) => void,
    onJoin?: (data: any) => void,
    onLeave?: (data: any) => void,
  ): EventSource {
    // Store handlers for reconnection
    this.messageHandler = onMessage;
    this.joinHandler = onJoin;
    this.leaveHandler = onLeave;
    this.shouldReconnect = true;

    this._connect();
    return this.eventSource!;
  }

  /**
   * Internal connection method with reconnection logic
   */
  private _connect(): void {
    const url = `${this.config.serverUrl}/stream`;
    this.config.log?.info?.(`[ChatClient] Connecting to SSE: ${url} (attempt ${this.reconnectAttempts + 1})`);

    this.eventSource = new EventSource(url);

    this.eventSource.addEventListener('message', (event: any) => {
      try {
        const msg = JSON.parse(event.data);

        // Deduplication check
        if (isMessageProcessed(msg.id)) {
          this.config.log?.debug?.(`[ChatClient] Duplicate message ignored: ${msg.id}`);
          return;
        }

        markMessageProcessed(msg.id);
        this.lastMessageTimestamp = Math.max(this.lastMessageTimestamp, msg.timestamp || 0);

        if (this.messageHandler) {
          this.messageHandler(msg);
        }
      } catch (error: any) {
        this.config.log?.error?.(`[ChatClient] Failed to parse message: ${error.message}`);
      }
    });

    if (this.joinHandler) {
      this.eventSource.addEventListener('join', (event: any) => {
        try {
          const data = JSON.parse(event.data);
          this.joinHandler!(data);
        } catch (error: any) {
          this.config.log?.error?.(`[ChatClient] Failed to parse join event: ${error.message}`);
        }
      });
    }

    if (this.leaveHandler) {
      this.eventSource.addEventListener('leave', (event: any) => {
        try {
          const data = JSON.parse(event.data);
          this.leaveHandler!(data);
        } catch (error: any) {
          this.config.log?.error?.(`[ChatClient] Failed to parse leave event: ${error.message}`);
        }
      });
    }

    this.eventSource.addEventListener('open', () => {
      this.config.log?.info?.('[ChatClient] SSE connection established');
      const wasReconnect = this.reconnectAttempts > 0;
      // Reset reconnection backoff on successful connection
      this.reconnectAttempts = 0;

      // On reconnect, catch up on missed messages
      if (wasReconnect && this.lastMessageTimestamp > 0 && this.messageHandler) {
        this._catchUpMessages();
      }
    });

    this.eventSource.onerror = (error: any) => {
      this.config.log?.error?.(`[ChatClient] SSE error: ${error.message || 'Connection error'}`);

      // Close current connection
      if (this.eventSource) {
        this.eventSource.close();
      }

      // Attempt reconnection with exponential backoff if not manually closed
      if (this.shouldReconnect) {
        this._scheduleReconnect();
      }
    };
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private _scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.config.log?.info?.(`[ChatClient] Reconnecting in ${delay}ms...`);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this._connect();
    }, delay);
  }

  /**
   * Catch up on messages missed during SSE reconnection
   */
  private async _catchUpMessages(): Promise<void> {
    try {
      this.config.log?.info?.(`[ChatClient] Catching up messages since ${this.lastMessageTimestamp}`);
      const missed = await this.getMessages({
        since: this.lastMessageTimestamp,
        limit: 20,
      });

      let catchUpCount = 0;
      for (const msg of missed) {
        if (!isMessageProcessed(msg.id)) {
          markMessageProcessed(msg.id);
          this.lastMessageTimestamp = Math.max(this.lastMessageTimestamp, msg.timestamp || 0);
          catchUpCount++;
          if (this.messageHandler) {
            this.messageHandler(msg);
          }
        }
      }

      if (catchUpCount > 0) {
        this.config.log?.info?.(`[ChatClient] Caught up ${catchUpCount} missed messages`);
      }
    } catch (error: any) {
      this.config.log?.error?.(`[ChatClient] Failed to catch up messages: ${error.message}`);
    }
  }

  /**
   * Close SSE connection and prevent reconnection
   */
  close(): void {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.config.log?.info?.('[ChatClient] SSE connection closed');
    }
  }

  /**
   * Get activity status from server
   */
  async getActivityStatus(): Promise<{
    isIdle: boolean;
    lastMessageTime: number;
    activeMembers: string[];
    messageCount: number;
  }> {
    try {
      const response = await axios.get(`${this.config.serverUrl}/activity`, {
        timeout: 5000,
      });
      return response.data;
    } catch (error: any) {
      this.config.log?.error?.(`[ChatClient] Failed to get activity: ${error.message}`);
      return {
        isIdle: false,
        lastMessageTime: Date.now(),
        activeMembers: [],
        messageCount: 0,
      };
    }
  }

  /**
   * Request proactive turn from server
   */
  async requestProactiveTurn(agentName: string): Promise<{
    granted: boolean;
    lockUntil?: number;
  }> {
    try {
      const response = await axios.post(
        `${this.config.serverUrl}/proactive/request-turn`,
        { agentName },
        { timeout: 5000 }
      );
      return response.data;
    } catch (error: any) {
      this.config.log?.error?.(`[ChatClient] Failed to request turn: ${error.message}`);
      return { granted: false };
    }
  }
}
