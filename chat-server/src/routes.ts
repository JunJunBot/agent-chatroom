import { Router, Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { store } from './store';
import { sseManager } from './sse';
import { validateMessage, securityMonitor } from './security';
import { globalRateLimiter } from './rate-limit';
import { eventBuffer } from './event-buffer';

const router = Router();

// POST /join - Join the chatroom
router.post('/join', (req: Request, res: Response) => {
  const { name, type } = req.body;

  if (!name || !type) {
    return res.status(400).json({
      success: false,
      error: 'Missing name or type'
    });
  }

  if (type !== 'human' && type !== 'agent') {
    return res.status(400).json({
      success: false,
      error: 'Invalid type, must be human or agent'
    });
  }

  // Check MAX_AGENTS limit for agents
  if (type === 'agent') {
    const currentAgents = store.getMembers().filter(m => m.type === 'agent').length;
    if (!globalRateLimiter.checkAgentLimit(currentAgents)) {
      return res.status(429).json({
        success: false,
        error: 'Maximum number of agents reached (100)'
      });
    }
  }

  const { member, isNew } = store.addMember(name, type);

  // Broadcast join event only for new members
  if (isNew) {
    sseManager.broadcastJoin(name, type);
    eventBuffer.addEvent({ type: 'join', name });
  }

  res.json({
    success: true,
    data: member
  });
});

// GET /members - Get all members
router.get('/members', (req: Request, res: Response) => {
  const members = store.getMembers();
  res.json(members);
});

// GET /messages - Get messages with optional filtering
router.get('/messages', (req: Request, res: Response) => {
  const since = req.query.since ? parseInt(req.query.since as string) : 0;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

  const messages = store.getMessages(since, limit);
  res.json(messages);
});

// POST /messages - Send a message
router.post('/messages', (req: Request, res: Response) => {
  const { sender, content, replyTo, isMentionReply } = req.body;

  if (!sender || !content) {
    return res.status(400).json({
      success: false,
      error: 'Missing sender or content'
    });
  }

  // Get sender type
  const members = store.getMembers();
  const member = members.find(m => m.name === sender);

  if (!member) {
    return res.status(404).json({
      success: false,
      error: 'Sender not found. Please join the chat first.'
    });
  }

  const senderType = member.type;

  // 1. Security validation
  const validation = validateMessage(sender, content, senderType);
  if (!validation.valid) {
    securityMonitor.record({
      type: 'input_violation',
      severity: 'medium',
      sender,
      message: validation.reason || 'Validation failed'
    });

    return res.status(400).json({
      success: false,
      error: validation.reason
    });
  }

  // 2. Mute check
  if (member.muted) {
    // Auto-unmute if time expired
    if (member.mutedUntil && Date.now() >= member.mutedUntil) {
      member.muted = false;
      member.mutedUntil = undefined;
    } else {
      return res.status(403).json({
        success: false,
        error: 'You are muted',
        mutedUntil: member.mutedUntil
      });
    }
  }

  // 3. Global rate limit check (replaces old simple rate limit for agents)
  const allMessages = store.getAllMessages();
  const rateLimitResult = globalRateLimiter.checkRateLimit(sender, senderType, allMessages);

  if (!rateLimitResult.allowed) {
    securityMonitor.record({
      type: 'rate_limit',
      severity: 'low',
      sender,
      message: rateLimitResult.reason || 'Rate limit exceeded'
    });

    return res.status(429).json({
      success: false,
      error: rateLimitResult.reason,
      retryAfter: rateLimitResult.retryAfter
    });
  }

  // Exception: @mention replies bypass rate limit for agents (legacy behavior)
  const shouldCheckRateLimit = !(isMentionReply && senderType === 'agent');
  if (shouldCheckRateLimit) {
    const oldRateLimitResult = store.checkRateLimit(sender, 5000);
    if (!oldRateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        retryAfter: oldRateLimitResult.retryAfter,
        message: `Please wait ${Math.ceil(oldRateLimitResult.retryAfter / 1000)} seconds between messages`
      });
    }
  }

  // 4. Anti-spam: check consecutive agent messages (isMentionReply bypasses this)
  if (senderType === 'agent' && !isMentionReply) {
    const consecutiveAgents = store.getConsecutiveAgentCount();
    if (consecutiveAgents >= 3) {
      return res.status(429).json({
        success: false,
        error: 'Too many consecutive agent messages',
        message: 'Too many consecutive agent messages, please wait for human input'
      });
    }
  }

  // Add message to store (use sanitized content)
  const finalContent = validation.sanitizedContent || content;
  const message = store.addMessage(sender, senderType, finalContent, replyTo);

  // Increment message count
  store.incrementMessageCount(sender);

  // Broadcast message via SSE
  sseManager.broadcastMessage(message);

  res.status(201).json({
    success: true,
    data: message
  });
});

// GET /stream - SSE endpoint
router.get('/stream', (req: Request, res: Response) => {
  const clientId = nanoid(10);
  sseManager.addClient(clientId, res);
});

// GET /health - Health check
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    members: store.getMembers().length,
    messages: store.getAllMessages().length,
    sseClients: sseManager.getClientCount()
  });
});

// GET /activity - Get activity status
router.get('/activity', (req: Request, res: Response) => {
  const activityStatus = store.getActivityStatus();
  res.json(activityStatus);
});

// POST /proactive/request-turn - Request proactive turn for agent
router.post('/proactive/request-turn', (req: Request, res: Response) => {
  const { agentName } = req.body;

  if (!agentName) {
    return res.status(400).json({
      success: false,
      error: 'Missing agentName'
    });
  }

  const result = store.requestProactiveTurn(agentName);

  res.json({
    success: result.granted,
    data: result
  });
});

export default router;
