import { Router, Request, Response, NextFunction } from 'express';
import { store } from './store';
import { sseManager } from './sse';
import { securityMonitor } from './security';
import { eventBuffer } from './event-buffer';

const router = Router();

// Admin authentication middleware
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const adminToken = process.env.ADMIN_TOKEN;

  if (!adminToken) {
    res.status(503).json({
      success: false,
      error: 'Admin not configured'
    });
    return;
  }

  const providedToken = req.headers['x-admin-token'];

  if (providedToken !== adminToken) {
    res.status(401).json({
      success: false,
      error: 'Invalid admin token'
    });
    return;
  }

  next();
}

// POST /admin/mute - Mute a member
router.post('/mute', requireAdmin, (req: Request, res: Response) => {
  const { name, duration } = req.body;

  if (!name || typeof duration !== 'number') {
    return res.status(400).json({
      success: false,
      error: 'Missing name or duration'
    });
  }

  const member = store.getMemberByName(name);
  if (!member) {
    return res.status(404).json({
      success: false,
      error: 'Member not found'
    });
  }

  member.muted = true;
  member.mutedUntil = Date.now() + duration;

  // Broadcast mute event
  sseManager.broadcastMute(name, duration);

  // Record in event buffer
  eventBuffer.addEvent({
    type: 'mute',
    name,
    details: `Muted for ${duration}ms`
  });

  res.json({
    success: true,
    data: { name, mutedUntil: member.mutedUntil }
  });
});

// POST /admin/unmute - Unmute a member
router.post('/unmute', requireAdmin, (req: Request, res: Response) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({
      success: false,
      error: 'Missing name'
    });
  }

  const member = store.getMemberByName(name);
  if (!member) {
    return res.status(404).json({
      success: false,
      error: 'Member not found'
    });
  }

  member.muted = false;
  member.mutedUntil = undefined;

  // Record in event buffer
  eventBuffer.addEvent({
    type: 'unmute',
    name
  });

  res.json({
    success: true,
    data: { name }
  });
});

// POST /admin/kick - Kick a member
router.post('/kick', requireAdmin, (req: Request, res: Response) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({
      success: false,
      error: 'Missing name'
    });
  }

  const deleted = store.deleteMember(name);
  if (!deleted) {
    return res.status(404).json({
      success: false,
      error: 'Member not found'
    });
  }

  // Broadcast kick/leave event
  sseManager.broadcastKick(name);

  // Record in event buffer
  eventBuffer.addEvent({
    type: 'kick',
    name
  });

  res.json({
    success: true,
    data: { name }
  });
});

// GET /admin/stats - Get member and message stats
router.get('/stats', requireAdmin, (req: Request, res: Response) => {
  const members = store.getMembers();
  const allMessages = store.getAllMessages();
  const activityStatus = store.getActivityStatus();

  // Calculate message rate (messages per minute in last hour)
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const recentMessages = allMessages.filter(m => m.timestamp > oneHourAgo);
  const messageRate = recentMessages.length / 60; // per minute

  const securityStats = securityMonitor.getStats();

  res.json({
    members: {
      total: members.length,
      humans: members.filter(m => m.type === 'human').length,
      agents: members.filter(m => m.type === 'agent').length,
      muted: members.filter(m => m.muted).length
    },
    messages: {
      total: allMessages.length,
      recentHour: recentMessages.length,
      ratePerMinute: messageRate.toFixed(2)
    },
    activity: activityStatus,
    security: {
      totalEvents: securityStats.total
    }
  });
});

// GET /admin/security - Get security events and stats
router.get('/security', requireAdmin, (req: Request, res: Response) => {
  const stats = securityMonitor.getStats();
  res.json(stats);
});

export default router;
