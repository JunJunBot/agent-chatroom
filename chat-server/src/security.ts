export interface SecurityEvent {
  type: 'input_violation' | 'output_violation' | 'spam' | 'rate_limit' | 'injection_attempt';
  severity: 'low' | 'medium' | 'high';
  sender: string;
  message: string;
  timestamp: number;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  sanitizedContent?: string;
}

export function validateMessage(sender: string, content: string, senderType: string): ValidationResult {
  // Sender max 50 chars
  if (sender.length > 50) {
    return { valid: false, reason: 'Sender name too long (max 50 characters)' };
  }

  // Content max 2000 chars
  if (content.length > 2000) {
    return { valid: false, reason: 'Content too long (max 2000 characters)' };
  }

  // SenderType validation
  if (senderType !== 'human' && senderType !== 'agent') {
    return { valid: false, reason: 'Invalid sender type, must be human or agent' };
  }

  // Remove HTML tags
  const sanitizedContent = content.replace(/<[^>]*>/g, '');

  // Check @mentions count (max 5)
  const mentions = content.match(/@[^\s@]+/g) || [];
  if (mentions.length > 5) {
    return { valid: false, reason: 'Too many mentions (max 5)' };
  }

  // Spam detection: repeated chars (>10 same char)
  if (/(.)\1{9,}/.test(content)) {
    return { valid: false, reason: 'Spam detected: excessive repeated characters' };
  }

  // Spam detection: excessive caps (>80% uppercase for messages with 5+ Latin letters)
  if (content.length > 20) {
    const uppercaseCount = (content.match(/[A-Z]/g) || []).length;
    const lettersCount = (content.match(/[A-Za-z]/g) || []).length;
    if (lettersCount >= 5) {
      const uppercasePercent = uppercaseCount / lettersCount;
      if (uppercasePercent > 0.8) {
        return { valid: false, reason: 'Spam detected: excessive uppercase' };
      }
    }
  }

  // Spam detection: URL count (>3)
  const urlCount = (content.match(/https?:\/\//g) || []).length;
  if (urlCount > 3) {
    return { valid: false, reason: 'Spam detected: too many URLs' };
  }

  return { valid: true, sanitizedContent };
}

export class SecurityMonitor {
  private static instance: SecurityMonitor;
  private events: SecurityEvent[] = [];
  private readonly MAX_EVENTS = 1000;

  private constructor() {}

  static getInstance(): SecurityMonitor {
    if (!SecurityMonitor.instance) {
      SecurityMonitor.instance = new SecurityMonitor();
    }
    return SecurityMonitor.instance;
  }

  record(event: Omit<SecurityEvent, 'timestamp'>): void {
    this.events.push({
      ...event,
      timestamp: Date.now()
    });

    // Trim oldest if exceeds max
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(-this.MAX_EVENTS);
    }
  }

  getStats(): {
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    topOffenders: { sender: string; count: number }[];
  } {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const senderCounts: Record<string, number> = {};

    for (const event of this.events) {
      byType[event.type] = (byType[event.type] || 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;
      senderCounts[event.sender] = (senderCounts[event.sender] || 0) + 1;
    }

    // Get top 10 offenders
    const topOffenders = Object.entries(senderCounts)
      .map(([sender, count]) => ({ sender, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      total: this.events.length,
      byType,
      bySeverity,
      topOffenders
    };
  }

  getRecentEvents(limit: number = 100): SecurityEvent[] {
    return this.events.slice(-limit);
  }
}

export const securityMonitor = SecurityMonitor.getInstance();
