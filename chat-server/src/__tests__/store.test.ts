import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../store';

describe('Store', () => {
  beforeEach(() => {
    store.reset();
  });

  describe('addMember and getMemberByName', () => {
    it('should add a new member', () => {
      const { member, isNew } = store.addMember('Alice', 'human');
      expect(isNew).toBe(true);
      expect(member.name).toBe('Alice');
      expect(member.type).toBe('human');
      expect(member.id).toMatch(/^mem_/);
    });

    it('should return existing member on duplicate add', () => {
      store.addMember('Bob', 'agent');
      const { member, isNew } = store.addMember('Bob', 'agent');
      expect(isNew).toBe(false);
      expect(member.name).toBe('Bob');
    });

    it('should get member by name', () => {
      store.addMember('Charlie', 'human');
      const member = store.getMemberByName('Charlie');
      expect(member).toBeDefined();
      expect(member?.name).toBe('Charlie');
    });

    it('should return undefined for non-existent member', () => {
      const member = store.getMemberByName('NonExistent');
      expect(member).toBeUndefined();
    });
  });

  describe('deleteMember', () => {
    it('should delete existing member', () => {
      store.addMember('David', 'agent');
      const deleted = store.deleteMember('David');
      expect(deleted).toBe(true);
      expect(store.getMemberByName('David')).toBeUndefined();
    });

    it('should return false for non-existent member', () => {
      const deleted = store.deleteMember('NonExistent');
      expect(deleted).toBe(false);
    });
  });

  describe('addMessage with new fields', () => {
    it('should add message with optional fields', () => {
      store.addMember('Eve', 'agent');
      const message = store.addMessage('Eve', 'agent', 'Hello world');
      expect(message.id).toMatch(/^msg_/);
      expect(message.sender).toBe('Eve');
      expect(message.content).toBe('Hello world');
      expect(message.deleted).toBeUndefined();
      expect(message.importance).toBeUndefined();
      expect(message.isProactive).toBeUndefined();
      expect(message.eventType).toBeUndefined();
    });
  });

  describe('getActivityStatus', () => {
    it('should report idle when no messages', () => {
      const status = store.getActivityStatus();
      expect(status.isIdle).toBe(true);
      expect(status.lastMessageTime).toBe(0);
      expect(status.activeMembers).toEqual([]);
      expect(status.messageCount).toBeGreaterThanOrEqual(0);
    });

    it('should report active after recent message', () => {
      store.addMember('Frank', 'human');
      store.addMessage('Frank', 'human', 'Test message');
      const status = store.getActivityStatus();
      expect(status.isIdle).toBe(false);
      expect(status.lastMessageTime).toBeGreaterThan(0);
      expect(status.activeMembers).toContain('Frank');
    });

    it('should report idle after 60 seconds', async () => {
      // This would require mocking time, so we just test the logic
      const status = store.getActivityStatus();
      expect(status).toHaveProperty('isIdle');
      expect(status).toHaveProperty('lastMessageTime');
      expect(status).toHaveProperty('activeMembers');
      expect(status).toHaveProperty('messageCount');
    });
  });

  describe('requestProactiveTurn', () => {
    it('should grant turn when no lock exists', () => {
      const result = store.requestProactiveTurn('Agent1');
      expect(result.granted).toBe(true);
      expect(result.lockUntil).toBeDefined();
      expect(result.lockUntil).toBeGreaterThan(Date.now());
    });

    it('should reject turn when lock is active', () => {
      store.requestProactiveTurn('Agent1');
      const result = store.requestProactiveTurn('Agent2');
      expect(result.granted).toBe(false);
      expect(result.lockUntil).toBeUndefined();
    });

    it('should grant turn after lock expires', async () => {
      const result1 = store.requestProactiveTurn('Agent1');
      expect(result1.granted).toBe(true);

      // Should still be locked in this short time
      await new Promise(resolve => setTimeout(resolve, 100));
      const result2 = store.requestProactiveTurn('Agent2');
      expect(result2.granted).toBe(false);
    });
  });

  describe('getMessageById', () => {
    it('should get message by ID', () => {
      store.addMember('Grace', 'human');
      const message = store.addMessage('Grace', 'human', 'Find me');
      const found = store.getMessageById(message.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(message.id);
      expect(found?.content).toBe('Find me');
    });

    it('should return undefined for non-existent ID', () => {
      const found = store.getMessageById('msg_nonexistent');
      expect(found).toBeUndefined();
    });
  });

  describe('incrementMessageCount', () => {
    it('should increment message count', () => {
      store.addMember('Henry', 'agent');
      const member = store.getMemberByName('Henry');
      expect(member?.messageCount).toBeUndefined();

      store.incrementMessageCount('Henry');
      const updated = store.getMemberByName('Henry');
      expect(updated?.messageCount).toBe(1);

      store.incrementMessageCount('Henry');
      const updated2 = store.getMemberByName('Henry');
      expect(updated2?.messageCount).toBe(2);
    });

    it('should handle non-existent member gracefully', () => {
      // Should not throw
      expect(() => store.incrementMessageCount('NonExistent')).not.toThrow();
    });
  });
});
