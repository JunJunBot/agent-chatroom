/**
 * Chatroom Channel Plugin for OpenClaw
 *
 * Connects OpenClaw agents to a public chatroom server via REST API + SSE
 */

import axios from 'axios';
import type { ClawdbotPluginApi, PluginRuntime, ClawdbotConfig } from 'clawdbot/plugin-sdk';
import { ChatClient, type Message, type Member } from './chat-client.js';
import { ReplyStrategy } from './strategy.js';
import { InputSanitizer, OutputFilter, ChainProtector } from './security.js';
import { buildRoomContext, type RoomContext, type RoomEvent } from './context.js';
import { formatChatHistory } from './formatting.js';
import { buildSystemPrompt } from './prompt.js';
import { MentionIntelligence } from './mention-intel.js';
import { compressContext } from './context-compression.js';
import { ProactiveEngine } from './proactive-engine.js';

// ============ Constants ============

let runtime: PluginRuntime | null = null;

function getRuntime(): PluginRuntime {
  if (!runtime) throw new Error('Chatroom runtime not initialized');
  return runtime;
}

// ============ Config Utilities ============

function getConfig(cfg: ClawdbotConfig) {
  return (cfg?.channels as any)?.['chatroom-connector'] || {};
}

function isConfigured(cfg: ClawdbotConfig): boolean {
  const config = getConfig(cfg);
  return Boolean(config.serverUrl && config.agentName);
}

// ============ Gateway Call ============

interface LLMCallContext {
  messages: any[];
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  gatewayPort: number;
  gatewayToken?: string;
  gatewayPassword?: string;
  log?: any;
}

async function callLLM(ctx: LLMCallContext): Promise<string> {
  const { messages, llmBaseUrl, llmApiKey, llmModel, gatewayPort, gatewayToken, gatewayPassword, log } = ctx;

  // Determine URL: prefer direct LLM provider, fallback to gateway
  const url = llmBaseUrl
    ? `${llmBaseUrl.replace(/\/+$/, '')}/v1/chat/completions`
    : `http://127.0.0.1:${gatewayPort}/v1/chat/completions`;

  const model = llmModel || 'default';

  const headers: any = { 'Content-Type': 'application/json' };
  if (llmApiKey) {
    headers['Authorization'] = `Bearer ${llmApiKey}`;
  } else if (gatewayToken) {
    headers['Authorization'] = `Bearer ${gatewayToken}`;
  } else if (gatewayPassword) {
    headers['Authorization'] = `Bearer ${gatewayPassword}`;
  }

  log?.info?.(`[Chatroom] LLM call: ${url}, model=${model}`);

  try {
    const response = await axios.post(
      url,
      {
        model,
        messages,
        stream: false,
        max_tokens: 300,
        temperature: 0.7,
        tools: [],
        tool_choice: 'none',
        stop: ['[SYSTEM]', '[ADMIN]'],
      },
      { headers, timeout: 60000 },
    );

    const content = response.data?.choices?.[0]?.message?.content || '';
    return content.trim();
  } catch (error: any) {
    log?.error?.(`[Chatroom] LLM call failed: ${error.message}`);
    return '[SKIP]';
  }
}

// ============ Plugin Definition ============

const chatroomPlugin = {
  id: 'chatroom-connector',
  name: 'Chatroom Connector',
  version: '0.1.0',
  meta: {
    label: 'Chatroom',
    selectionLabel: 'Chatroom (Agent Chat)',
    detailLabel: 'Agent Chatroom',
    docsPath: '/channels/chatroom',
  },
  reload: { configPrefixes: ['channels.chatroom-connector'] },
  configSchema: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean', default: true },
        serverUrl: { type: 'string', description: 'Chatroom server URL (e.g., http://localhost:3000)' },
        agentName: { type: 'string', description: 'Agent display name in chatroom' },
        cooldownMin: { type: 'number', default: 5000, description: 'Minimum cooldown between replies (ms)' },
        cooldownMax: { type: 'number', default: 15000, description: 'Maximum cooldown between replies (ms)' },
        replyProbability: { type: 'number', default: 0.9, description: 'Probability of replying (0.0-1.0)' },
        mentionAlwaysReply: { type: 'boolean', default: true, description: 'Always reply when @mentioned' },
        maxContextMessages: { type: 'number', default: 20, description: 'Max chat history for context' },
        systemPrompt: { type: 'string', default: '', description: 'Additional system prompt' },
        gatewayToken: { type: 'string', default: '', description: 'Gateway auth token (Bearer)' },
        gatewayPassword: { type: 'string', default: '', description: 'Gateway auth password (alternative to token)' },
        llmBaseUrl: { type: 'string', default: '', description: 'Direct LLM provider URL (e.g., litellm proxy). Bypasses gateway REST.' },
        llmApiKey: { type: 'string', default: '', description: 'API key for direct LLM provider' },
        llmModel: { type: 'string', default: '', description: 'Model ID for direct LLM provider (e.g., claude-sonnet-4-5)' },
        proactiveEnabled: { type: 'boolean', default: false, description: 'Enable proactive speaking' },
        proactiveMinIdleTime: { type: 'number', default: 60000, description: 'Min idle time before proactive (ms)' },
        proactiveCooldown: { type: 'number', default: 300000, description: 'Cooldown between proactive messages (ms)' },
        contextStrategy: { type: 'string', default: 'hybrid', enum: ['recent', 'important', 'hybrid'], description: 'Context compression strategy' },
        securityEnabled: { type: 'boolean', default: true, description: 'Enable security filtering' },
      },
      required: ['serverUrl', 'agentName'],
    },
    uiHints: {
      enabled: { label: 'Enable Chatroom' },
      serverUrl: { label: 'Server URL', sensitive: false },
      agentName: { label: 'Agent Name', sensitive: false },
      cooldownMin: { label: 'Min Cooldown (ms)' },
      cooldownMax: { label: 'Max Cooldown (ms)' },
      replyProbability: { label: 'Reply Probability' },
      mentionAlwaysReply: { label: 'Always Reply on Mention' },
      maxContextMessages: { label: 'Max Context Messages' },
      systemPrompt: { label: 'System Prompt' },
      gatewayToken: { label: 'Gateway Token', sensitive: true },
      gatewayPassword: { label: 'Gateway Password', sensitive: true },
      llmBaseUrl: { label: 'LLM Provider URL', sensitive: false },
      llmApiKey: { label: 'LLM API Key', sensitive: true },
      llmModel: { label: 'LLM Model ID', sensitive: false },
      proactiveEnabled: { label: 'Enable Proactive Speaking' },
      proactiveMinIdleTime: { label: 'Min Idle Time (ms)' },
      proactiveCooldown: { label: 'Proactive Cooldown (ms)' },
      contextStrategy: { label: 'Context Strategy' },
      securityEnabled: { label: 'Enable Security' },
    },
  },
  config: {
    listAccountIds: (cfg: ClawdbotConfig) => {
      const config = getConfig(cfg);
      return config.accounts
        ? Object.keys(config.accounts)
        : isConfigured(cfg)
        ? ['default']
        : [];
    },
    resolveAccount: (cfg: ClawdbotConfig, accountId?: string) => {
      const config = getConfig(cfg);
      const id = accountId || 'default';
      if (config.accounts?.[id]) {
        return {
          accountId: id,
          config: config.accounts[id],
          enabled: config.accounts[id].enabled !== false,
        };
      }
      return { accountId: 'default', config, enabled: config.enabled !== false };
    },
    defaultAccountId: () => 'default',
    isConfigured: (account: any) => Boolean(account.config?.serverUrl && account.config?.agentName),
    describeAccount: (account: any) => ({
      accountId: account.accountId,
      name: account.config?.agentName || 'Chatroom Agent',
      enabled: account.enabled,
      configured: Boolean(account.config?.serverUrl),
    }),
  },
  gateway: {
    // ctx: any is intentional - OpenClaw SDK doesn't export full typed context interface
    // Contains: { account, cfg, abortSignal, log }
    startAccount: async (ctx: any) => {
      const { account, cfg, abortSignal } = ctx;
      const config = account.config;

      if (!config.serverUrl || !config.agentName) {
        throw new Error('Chatroom serverUrl and agentName are required');
      }

      // Validate replyProbability range
      const replyProbability = config.replyProbability ?? 0.9;
      if (replyProbability < 0 || replyProbability > 1) {
        throw new Error('replyProbability must be between 0 and 1');
      }

      ctx.log?.info(`[${account.accountId}] Starting chatroom connector for ${config.agentName}...`);

      // Create security modules
      const inputSanitizer = new InputSanitizer();
      const outputFilter = new OutputFilter();
      const chainProtector = new ChainProtector();

      // Create chat client
      const chatClient = new ChatClient({
        serverUrl: config.serverUrl,
        agentName: config.agentName,
        log: ctx.log,
      });

      // Create reply strategy
      const strategy = new ReplyStrategy({
        agentName: config.agentName,
        replyProbability,
        mentionAlwaysReply: config.mentionAlwaysReply ?? true,
        cooldownMin: config.cooldownMin ?? 5000,
        cooldownMax: config.cooldownMax ?? 15000,
      });

      // Create mention intelligence
      const mentionIntel = new MentionIntelligence(config.agentName);

      // Join the room
      const joinResult = await chatClient.join(config.agentName, 'agent');
      if (!joinResult.success) {
        throw new Error(`Failed to join chatroom: ${joinResult.error}`);
      }

      ctx.log?.info(`[${account.accountId}] Joined chatroom as ${config.agentName}`);

      // Get gateway port from runtime
      const rt = getRuntime();
      const gatewayPort = rt.gateway?.port || 18789;

      // Track room events
      const roomEvents: RoomEvent[] = [];

      let stopped = false;
      let proactiveEngine: ProactiveEngine | null = null;

      // Helper: Build context
      const buildContext = async (): Promise<RoomContext> => {
        const members = await chatClient.getMembers();
        const messages = await chatClient.getMessages({ limit: config.maxContextMessages ?? 20 });
        return buildRoomContext(config.agentName, members, messages, roomEvents);
      };

      // Helper: Generate topic for proactive speaking
      const generateTopic = async (): Promise<string> => {
        const systemPrompt = 'Generate a casual, interesting topic to discuss in a chatroom. Be creative and relevant. Output only the topic text, nothing else.';
        const messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Generate a topic' },
        ];

        return callLLM({
          messages,
          llmBaseUrl: config.llmBaseUrl,
          llmApiKey: config.llmApiKey,
          llmModel: config.llmModel,
          gatewayPort,
          gatewayToken: config.gatewayToken,
          gatewayPassword: config.gatewayPassword,
          log: ctx.log,
        });
      };

      // Start proactive engine if enabled
      if (config.proactiveEnabled) {
        proactiveEngine = new ProactiveEngine({
          serverUrl: config.serverUrl,
          agentName: config.agentName,
          checkInterval: 30000,
          minIdleTime: config.proactiveMinIdleTime ?? 60000,
          cooldown: config.proactiveCooldown ?? 300000,
          maxDailyPerAgent: 20,
          maxDailyGlobal: 50,
          enabled: true,
          onSpeak: async (content: string) => {
            await chatClient.sendMessage(config.agentName, content);
          },
          onGenerateTopic: generateTopic,
          log: ctx.log,
        });
        proactiveEngine.start();
      }

      // Connect to SSE stream
      chatClient.connectSSE(
        async (msg: Message) => {
          // Handle incoming message
          ctx.log?.info?.(`[Chatroom] Received message from ${msg.sender}: ${msg.content.substring(0, 50)}...`);

          // Ignore own messages
          if (msg.sender === config.agentName) {
            return;
          }

          // Decide if should reply (basic strategy)
          if (!strategy.shouldReply(msg)) {
            const cooldown = strategy.getCooldownRemaining();
            if (cooldown > 0) {
              ctx.log?.info?.(`[Chatroom] In cooldown, ${Math.round(cooldown / 1000)}s remaining`);
            } else {
              ctx.log?.info?.(`[Chatroom] Skipped reply (probability)`);
            }
            return;
          }

          // Build room context
          const roomContext = await buildContext();

          // Get recent messages for mention intelligence
          const allMessages = await chatClient.getMessages({ limit: 50 });

          // Check mention intelligence
          const mentionDecision = mentionIntel.shouldRespond(msg, roomContext, allMessages);
          if (!mentionDecision.respond) {
            ctx.log?.info?.(`[Chatroom] Skipped reply (${mentionDecision.reason})`);
            return;
          }

          ctx.log?.info?.(`[Chatroom] Processing message, will reply (${mentionDecision.reason})...`);

          try {
            // Get chat history
            let history = await chatClient.getMessages({
              limit: config.maxContextMessages ?? 20,
            });

            // Sanitize input if security enabled
            let sanitizedContent = msg.content;
            if (config.securityEnabled !== false) {
              const sanitizeResult = inputSanitizer.sanitize(msg.content);
              sanitizedContent = sanitizeResult.sanitized;
              if (!sanitizeResult.safe) {
                ctx.log?.warn?.(`[Chatroom] Input threats detected: ${sanitizeResult.threats.join(', ')}`);
              }
            }

            // Compress context
            const compressed = compressContext(history, msg, {
              strategy: config.contextStrategy || 'hybrid',
              maxTokens: 2000,
              agentName: config.agentName,
            });

            // Build enhanced system prompt
            const systemPrompt = buildSystemPrompt(config, roomContext);

            // Format chat history with context
            const userContent = formatChatHistory(compressed, { ...msg, content: sanitizedContent }, roomContext);

            const messages = [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ];

            // Call LLM (direct provider or gateway)
            let reply = await callLLM({
              messages,
              llmBaseUrl: config.llmBaseUrl,
              llmApiKey: config.llmApiKey,
              llmModel: config.llmModel,
              gatewayPort,
              gatewayToken: config.gatewayToken,
              gatewayPassword: config.gatewayPassword,
              log: ctx.log,
            });

            // Filter output if security enabled
            if (config.securityEnabled !== false) {
              const filterResult = outputFilter.filter(reply);
              if (!filterResult.safe) {
                ctx.log?.warn?.(`[Chatroom] Output violations detected: ${filterResult.violations.join(', ')}`);
              }
              reply = filterResult.filtered;
            }

            ctx.log?.info?.(`[Chatroom] Gateway reply: ${reply.substring(0, 100)}...`);

            // Send reply if not [SKIP]
            if (!reply.includes('[SKIP]')) {
              const isMentionReply = mentionDecision.reason === 'directly_mentioned';
              const sendResult = await chatClient.sendMessage(
                config.agentName,
                reply,
                mentionDecision.replyTo || msg.id,
                isMentionReply,
              );

              if (sendResult.success) {
                ctx.log?.info?.(`[Chatroom] Reply sent successfully`);
                strategy.startCooldown();
                strategy.resetBackoff();
              } else {
                ctx.log?.error?.(`[Chatroom] Failed to send reply: ${sendResult.error}`);
                if (sendResult.error?.includes('429')) {
                  strategy.recordRateLimit();
                }
              }
            } else {
              ctx.log?.info?.(`[Chatroom] Agent decided to skip reply`);
            }
          } catch (error: any) {
            ctx.log?.error?.(`[Chatroom] Error processing message: ${error.message}`);
          }
        },
        (data) => {
          ctx.log?.info?.(`[Chatroom] User joined: ${data.name}`);
          roomEvents.push({
            type: 'join',
            name: data.name,
            timestamp: Date.now(),
          });
        },
        (data) => {
          ctx.log?.info?.(`[Chatroom] User left: ${data.name}`);
          roomEvents.push({
            type: 'leave',
            name: data.name,
            timestamp: Date.now(),
          });
        },
      );

      // Record channel activity start
      rt.channel.activity.record('chatroom-connector', account.accountId, 'start');

      ctx.log?.info(`[${account.accountId}] Chatroom connector started successfully`);

      // Return a Promise that only resolves on abort (prevents framework auto-restart)
      return new Promise<void>((resolve) => {
        abortSignal?.addEventListener('abort', () => {
          if (stopped) return;
          stopped = true;
          ctx.log?.info(`[${account.accountId}] Stopping chatroom connector...`);
          chatClient.close();
          if (proactiveEngine) {
            proactiveEngine.stop();
          }
          rt.channel.activity.record('chatroom-connector', account.accountId, 'stop');
          resolve();
        });
      });
    },
  },
  status: {
    probe: async ({ cfg }: any) => {
      const config = getConfig(cfg);
      if (!config.serverUrl || !config.agentName) {
        return {
          ok: false,
          message: 'Chatroom not configured',
          configured: false,
        };
      }

      try {
        // Try to connect to the server
        const response = await axios.get(`${config.serverUrl}/members`, {
          timeout: 5000,
        });
        return {
          ok: true,
          message: `Connected to ${config.serverUrl}`,
          configured: true,
          members: response.data?.length || 0,
        };
      } catch (error: any) {
        return {
          ok: false,
          message: `Cannot connect to ${config.serverUrl}: ${error.message}`,
          configured: true,
        };
      }
    },
  },
};

// ============ Plugin Registration ============

const plugin = {
  id: 'chatroom-connector',
  name: 'Chatroom Channel',
  description: 'Connect OpenClaw agents to a chatroom server',
  configSchema: {
    type: 'object',
    additionalProperties: true,
    properties: { enabled: { type: 'boolean', default: true } },
  },
  register(api: ClawdbotPluginApi) {
    runtime = api.runtime;
    api.registerChannel({ plugin: chatroomPlugin });
  },
};

export default plugin;
