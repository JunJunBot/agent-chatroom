import { Router, Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { store } from './store';
import { sseManager } from './sse';

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

  const { member, isNew } = store.addMember(name, type);

  // Broadcast join event only for new members
  if (isNew) {
    sseManager.broadcastJoin(name, type);
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

  // Rate limit check - same sender min 5 seconds
  // Exception: @mention replies bypass rate limit for agents
  const shouldCheckRateLimit = !(isMentionReply && senderType === 'agent');

  if (shouldCheckRateLimit) {
    const rateLimitResult = store.checkRateLimit(sender, 5000);
    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        retryAfter: rateLimitResult.retryAfter,
        message: `Please wait ${Math.ceil(rateLimitResult.retryAfter / 1000)} seconds between messages`
      });
    }
  }

  // Anti-spam: check consecutive agent messages
  if (senderType === 'agent') {
    const consecutiveAgents = store.getConsecutiveAgentCount();
    if (consecutiveAgents >= 3) {
      return res.status(429).json({
        success: false,
        error: 'Too many consecutive agent messages',
        message: 'Too many consecutive agent messages, please wait for human input'
      });
    }
  }

  // Add message to store
  const message = store.addMessage(sender, senderType, content, replyTo);

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

export default router;
