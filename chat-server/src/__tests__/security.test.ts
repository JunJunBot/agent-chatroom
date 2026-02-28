import { describe, it, expect } from 'vitest';
import { validateMessage, securityMonitor, SecurityMonitor } from '../security';

describe('Security', () => {
  describe('validateMessage', () => {
    it('should validate correct message', () => {
      const result = validateMessage('Alice', 'Hello world', 'human');
      expect(result.valid).toBe(true);
      expect(result.sanitizedContent).toBe('Hello world');
    });

    it('should reject sender too long', () => {
      const longName = 'a'.repeat(51);
      const result = validateMessage(longName, 'Hello', 'human');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Sender name too long');
    });

    it('should reject content too long', () => {
      const longContent = 'a'.repeat(2001);
      const result = validateMessage('Alice', longContent, 'human');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Content too long');
    });

    it('should reject invalid sender type', () => {
      const result = validateMessage('Alice', 'Hello', 'robot' as any);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid sender type');
    });

    it('should remove HTML tags', () => {
      const result = validateMessage('Alice', 'Hello <script>alert("xss")</script> world', 'human');
      expect(result.valid).toBe(true);
      expect(result.sanitizedContent).toBe('Hello alert("xss") world');
      expect(result.sanitizedContent).not.toContain('<script>');
    });

    it('should reject too many mentions', () => {
      const content = '@user1 @user2 @user3 @user4 @user5 @user6';
      const result = validateMessage('Alice', content, 'human');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Too many mentions');
    });

    it('should allow up to 5 mentions', () => {
      const content = '@user1 @user2 @user3 @user4 @user5';
      const result = validateMessage('Alice', content, 'human');
      expect(result.valid).toBe(true);
    });

    it('should detect repeated characters spam', () => {
      const result = validateMessage('Alice', 'aaaaaaaaaa', 'human');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('repeated characters');
    });

    it('should detect excessive caps', () => {
      const result = validateMessage('Alice', 'HELLO WORLD THIS IS ALL CAPS!!!', 'human');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('excessive uppercase');
    });

    it('should allow caps in short messages', () => {
      const result = validateMessage('Alice', 'HELLO', 'human');
      expect(result.valid).toBe(true);
    });

    it('should detect too many URLs', () => {
      const content = 'Check https://a.com https://b.com https://c.com https://d.com';
      const result = validateMessage('Alice', content, 'human');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('too many URLs');
    });

    it('should allow up to 3 URLs', () => {
      const content = 'Check https://a.com https://b.com https://c.com';
      const result = validateMessage('Alice', content, 'human');
      expect(result.valid).toBe(true);
    });
  });

  describe('SecurityMonitor', () => {
    it('should be a singleton', () => {
      const instance1 = SecurityMonitor.getInstance();
      const instance2 = SecurityMonitor.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should record events', () => {
      securityMonitor.record({
        type: 'spam',
        severity: 'low',
        sender: 'Spammer',
        message: 'Spam detected'
      });

      const stats = securityMonitor.getStats();
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.byType['spam']).toBeGreaterThan(0);
      expect(stats.bySeverity['low']).toBeGreaterThan(0);
    });

    it('should return top offenders', () => {
      securityMonitor.record({
        type: 'spam',
        severity: 'medium',
        sender: 'BadActor1',
        message: 'Test'
      });
      securityMonitor.record({
        type: 'spam',
        severity: 'medium',
        sender: 'BadActor1',
        message: 'Test'
      });
      securityMonitor.record({
        type: 'spam',
        severity: 'medium',
        sender: 'BadActor2',
        message: 'Test'
      });

      const stats = securityMonitor.getStats();
      expect(stats.topOffenders.length).toBeGreaterThan(0);
      expect(stats.topOffenders[0].sender).toBe('BadActor1');
      expect(stats.topOffenders[0].count).toBe(2);
    });

    it('should trim events to max 1000', () => {
      // Record 1100 events
      for (let i = 0; i < 1100; i++) {
        securityMonitor.record({
          type: 'spam',
          severity: 'low',
          sender: `User${i}`,
          message: 'Test'
        });
      }

      const stats = securityMonitor.getStats();
      expect(stats.total).toBeLessThanOrEqual(1000);
    });

    it('should get recent events with limit', () => {
      securityMonitor.record({
        type: 'rate_limit',
        severity: 'low',
        sender: 'User1',
        message: 'Rate limited'
      });

      const recent = securityMonitor.getRecentEvents(10);
      expect(recent.length).toBeLessThanOrEqual(10);
      expect(recent[recent.length - 1].type).toBe('rate_limit');
    });
  });
});
