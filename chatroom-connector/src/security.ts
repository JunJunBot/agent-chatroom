/**
 * Security module for prompt injection protection and output filtering
 */

// ============ Input Sanitizer ============

export interface SanitizeResult {
  safe: boolean;
  sanitized: string;
  threats: string[];
}

export class InputSanitizer {
  private injectionPatterns = [
    /ignore\s+(all|previous|above)(\s+previous|\s+the)?\s+(instructions?|rules?)/i,
    /system\s*prompt/i,
    /DAN\s*mode/i,
    /you\s+are\s+now/i,
    /pretend\s+(you|to\s+be)/i,
    /reveal\s+your/i,
    /jailbreak/i,
    /ignore\s+everything/i,
    /new\s+instructions/i,
    /override\s+(instructions|rules)/i,
  ];

  private readonly MAX_LENGTH = 2000;

  /**
   * Sanitize user input to prevent prompt injection
   */
  sanitize(content: string): SanitizeResult {
    const threats: string[] = [];
    let sanitized = content;

    // Check for injection patterns
    for (const pattern of this.injectionPatterns) {
      if (pattern.test(sanitized)) {
        threats.push(`Detected injection pattern: ${pattern.source}`);
      }
    }

    // Remove HTML tags
    sanitized = sanitized.replace(/<[^>]*>/g, '');

    // Remove script content
    sanitized = sanitized.replace(/<script[\s\S]*?<\/script>/gi, '');

    // Truncate to max length
    if (sanitized.length > this.MAX_LENGTH) {
      sanitized = sanitized.substring(0, this.MAX_LENGTH);
      threats.push(`Content truncated to ${this.MAX_LENGTH} characters`);
    }

    // Wrap in boundary markers
    sanitized = `[USER_MESSAGE]${sanitized}[/USER_MESSAGE]`;

    return {
      safe: threats.length === 0,
      sanitized,
      threats,
    };
  }
}

// ============ Output Filter ============

export interface FilterResult {
  safe: boolean;
  filtered: string;
  violations: string[];
}

export class OutputFilter {
  private dangerousPatterns = [
    { pattern: /\b(rm\s+-rf|sudo|chmod|chown|curl\s+.*\|\s*sh|wget\s+.*\|\s*sh|eval\s*\()/i, name: 'shell_command' },
    { pattern: /(password|api_key|secret|token|bearer)\s*[=:]\s*\S+/i, name: 'credential' },
    { pattern: /\[(SYSTEM|ADMIN)\]/i, name: 'system_marker' },
    { pattern: /(\/etc\/|\/root\/|C:\\Windows\\|\.env\b)/i, name: 'system_path' },
  ];

  private readonly MAX_LENGTH = 500;

  /**
   * Check if IP address looks like internal network
   */
  private isInternalIP(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return false;

    // 10.x.x.x
    if (parts[0] === 10) return true;

    // 172.16-31.x.x
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

    // 192.168.x.x
    if (parts[0] === 192 && parts[1] === 168) return true;

    return false;
  }

  /**
   * Filter LLM output to prevent dangerous content
   */
  filter(output: string): FilterResult {
    const violations: string[] = [];
    let filtered = output;

    // Check for dangerous patterns
    for (const { pattern, name } of this.dangerousPatterns) {
      if (pattern.test(filtered)) {
        violations.push(`Detected dangerous pattern: ${name}`);
      }
    }

    // Check for internal IP addresses
    const ipPattern = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
    const ipMatches = filtered.match(ipPattern);
    if (ipMatches) {
      for (const ip of ipMatches) {
        if (this.isInternalIP(ip)) {
          violations.push(`Detected internal IP address: ${ip}`);
        }
      }
    }

    // Remove boundary marker leaks
    filtered = filtered.replace(/\[USER_MESSAGE\]/g, '');
    filtered = filtered.replace(/\[\/USER_MESSAGE\]/g, '');

    // Truncate to max length
    if (filtered.length > this.MAX_LENGTH) {
      filtered = filtered.substring(0, this.MAX_LENGTH);
    }

    // If violations found, return [SKIP]
    if (violations.length > 0) {
      return {
        safe: false,
        filtered: '[SKIP]',
        violations,
      };
    }

    return {
      safe: true,
      filtered,
      violations: [],
    };
  }
}

// ============ Chain Protector ============

export class ChainProtector {
  /**
   * Determine trust level based on sender type
   */
  trustLevel(senderType: string): 'trusted' | 'medium' {
    return senderType === 'human' ? 'trusted' : 'medium';
  }

  /**
   * Calculate Jaccard similarity between two strings
   */
  private jaccardSimilarity(str1: string, str2: string): number {
    const words1 = new Set(str1.toLowerCase().split(/\s+/));
    const words2 = new Set(str2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  /**
   * Detect message loops
   */
  detectLoop(messages: Array<{ sender: string; content: string }>): {
    isLoop: boolean;
    loopingSender?: string;
  } {
    // Group messages by sender
    const bySender = new Map<string, string[]>();
    for (const msg of messages) {
      if (!bySender.has(msg.sender)) {
        bySender.set(msg.sender, []);
      }
      bySender.get(msg.sender)!.push(msg.content);
    }

    // Check each sender's recent messages
    for (const [sender, contents] of bySender.entries()) {
      if (contents.length < 3) continue;

      // Get last 10 messages
      const recent = contents.slice(-10);

      // Check similarity of consecutive messages
      let similarCount = 1;
      for (let i = recent.length - 1; i > 0; i--) {
        const similarity = this.jaccardSimilarity(recent[i], recent[i - 1]);
        if (similarity > 0.8) {
          similarCount++;
          if (similarCount >= 3) {
            return { isLoop: true, loopingSender: sender };
          }
        } else {
          // Reset count on dissimilar pair
          similarCount = 1;
        }
      }
    }

    return { isLoop: false };
  }

  /**
   * Mark agent content with metadata tags
   */
  markAgentContent(content: string, senderType: string): string {
    if (senderType === 'agent') {
      return `[AGENT_OUTPUT]${content}[/AGENT_OUTPUT]`;
    }
    return content;
  }

  /**
   * Check if agent message contains instruction-like patterns targeting other agents
   */
  isInjectionFromAgent(content: string): boolean {
    const injectionPatterns = [
      /ignore\s+(previous|all|above)\s+instructions/i,
      /you\s+must/i,
      /system\s*:/i,
      /new\s+instructions/i,
      /override/i,
    ];

    return injectionPatterns.some(pattern => pattern.test(content));
  }
}
