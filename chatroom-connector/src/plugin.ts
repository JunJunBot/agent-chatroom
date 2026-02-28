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

// ============ Chain-of-Thought Filter ============

/**
 * Filter out LLM chain-of-thought / internal reasoning from responses.
 * Models sometimes output their reasoning process instead of actual chat replies.
 */
function filterChainOfThought(text: string): string {
  if (!text) return text;

  // Patterns that indicate chain-of-thought / internal reasoning
  const cotPatterns = [
    /^I need to (check|think|consider|analyze|look|review|determine|figure|assess|evaluate)/i,
    /^Let me (check|think|consider|analyze|look|review|determine|figure|assess|evaluate)/i,
    /^First,?\s+I (need|should|will|must|have) to/i,
    /^(OK|Okay|Alright|Right),?\s+(so |now |let me |I need|I should)/i,
    /^(Thinking|Analyzing|Checking|Looking|Reviewing|Considering)/i,
    /^(Based on|According to) (the|my) (system|instructions|rules|prompt)/i,
    /^I('ll| will) (start|begin) by/i,
    /^(Step \d|1\.|First step)/i,
    /^My (task|role|job|goal) (is|here) to/i,
    /^As (an AI|a chatroom|the agent)/i,
  ];

  // Check if the entire response looks like internal reasoning
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // If first line matches a CoT pattern, the response is likely internal reasoning
  if (lines.length > 0 && cotPatterns.some(p => p.test(lines[0]))) {
    // Try to extract actual reply after the reasoning
    // Look for a line that doesn't match CoT patterns (the actual reply)
    for (let i = 1; i < lines.length; i++) {
      if (!cotPatterns.some(p => p.test(lines[i])) &&
          !lines[i].startsWith('-') &&
          !lines[i].startsWith('*') &&
          lines[i].length > 5) {
        return lines.slice(i).join('\n').trim();
      }
    }
    // If all lines are reasoning, skip
    return '[SKIP]';
  }

  // Also filter out common reasoning prefixes inline
  const inlineReasoningPrefixes = [
    /^(Hmm,?\s+)?I (think|believe|feel like) I should (respond|reply|say|answer)/i,
    /^I('m| am) going to (respond|reply|say|answer)/i,
  ];

  for (const pattern of inlineReasoningPrefixes) {
    if (pattern.test(text)) {
      const cleaned = text.replace(pattern, '').trim();
      // Remove leading punctuation
      return cleaned.replace(/^[.,:;!?\s]+/, '').trim() || '[SKIP]';
    }
  }

  return text;
}

// ============ Gateway Call ============

interface GatewayCallContext {
  messages: any[];
  gatewayPort: number;
  gatewayToken?: string;
  gatewayPassword?: string;
  log?: any;
}

async function callGateway(ctx: GatewayCallContext): Promise<string> {
  const { messages, gatewayPort, gatewayToken, gatewayPassword, log } = ctx;

  const url = `http://127.0.0.1:${gatewayPort}/v1/chat/completions`;

  const headers: any = { 'Content-Type': 'application/json' };
  if (gatewayToken) {
    headers['Authorization'] = `Bearer ${gatewayToken}`;
  } else if (gatewayPassword) {
    headers['Authorization'] = `Bearer ${gatewayPassword}`;
  }

  log?.info?.(`[Chatroom] Gateway call: ${url}`);

  try {
    const response = await axios.post(
      url,
      {
        model: 'default',
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
    return filterChainOfThought(content.trim());
  } catch (error: any) {
    log?.error?.(`[Chatroom] Gateway call failed: ${error.message}`);
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
        gatewayPort: { type: 'number', default: 0, description: 'Gateway port (0 = auto-detect from OpenClaw config)' },
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

      // Get gateway port: connector config > runtime > OpenClaw config > default
      const rt = getRuntime();
      const gatewayPort = config.gatewayPort || rt.gateway?.port || cfg?.gateway?.port || 18789;

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
        const agentPrompt = config.systemPrompt || '';
        const systemPrompt = `你是聊天室里的${config.agentName}。${agentPrompt}\n\n现在聊天室很安静，请主动发起一个有趣的话题或者说一句有趣的话来活跃气氛。用中文，符合你的人设风格。只输出要说的内容，不要输出其他任何东西。`;
        const messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '聊天室安静了一会儿了，说点什么吧' },
        ];

        return callGateway({
          messages,
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

            let reply = await callGateway({
              messages,
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
