import { EventEmitter } from 'events';

/**
 * Conversation State Manager
 * From autonomous-agent-patterns: Checkpoint/Resume pattern
 * 
 * Manages conversation state for recovery after failures
 */
export interface ConversationCheckpoint {
  id: string;
  timestamp: number;
  modelId: string;
  messages: any[];
  toolCalls?: any[];
  partialContent: string;
  metadata: {
    provider: string;
    latency: number;
    chunkCount: number;
  };
}

export class ConversationStateManager extends EventEmitter {
  private checkpoints: Map<string, ConversationCheckpoint> = new Map();
  private maxCheckpoints: number = 100;
  private checkpointTTL: number = 3600000; // 1 hour

  /**
   * Save a checkpoint before critical operations
   */
  saveCheckpoint(
    sessionId: string,
    state: Omit<ConversationCheckpoint, 'id' | 'timestamp'>
  ): string {
    const checkpointId = `${sessionId}-${Date.now()}`;
    
    const checkpoint: ConversationCheckpoint = {
      id: checkpointId,
      timestamp: Date.now(),
      ...state
    };

    this.checkpoints.set(checkpointId, checkpoint);
    this.emit('checkpoint:saved', checkpoint);

    // Cleanup old checkpoints
    this.cleanupOldCheckpoints();

    return checkpointId;
  }

  /**
   * Restore from a checkpoint
   */
  restoreCheckpoint(checkpointId: string): ConversationCheckpoint | null {
    const checkpoint = this.checkpoints.get(checkpointId);
    
    if (!checkpoint) {
      this.emit('checkpoint:not-found', checkpointId);
      return null;
    }

    // Check if checkpoint is still valid
    if (Date.now() - checkpoint.timestamp > this.checkpointTTL) {
      this.checkpoints.delete(checkpointId);
      this.emit('checkpoint:expired', checkpointId);
      return null;
    }

    this.emit('checkpoint:restored', checkpoint);
    return checkpoint;
  }

  /**
   * Get latest checkpoint for a session
   */
  getLatestCheckpoint(sessionId: string): ConversationCheckpoint | null {
    const sessionCheckpoints = Array.from(this.checkpoints.values())
      .filter(cp => cp.id.startsWith(sessionId))
      .sort((a, b) => b.timestamp - a.timestamp);

    return sessionCheckpoints[0] || null;
  }

  /**
   * Get all checkpoints for tool conversations
   */
  getToolConversationCheckpoints(): ConversationCheckpoint[] {
    return Array.from(this.checkpoints.values())
      .filter(cp => cp.toolCalls && cp.toolCalls.length > 0);
  }

  /**
   * Delete a checkpoint
   */
  deleteCheckpoint(checkpointId: string): boolean {
    const deleted = this.checkpoints.delete(checkpointId);
    if (deleted) {
      this.emit('checkpoint:deleted', checkpointId);
    }
    return deleted;
  }

  /**
   * Get checkpoint statistics
   */
  getStats(): {
    total: number;
    toolConversations: number;
    oldestAge: number;
    newestAge: number;
  } {
    const checkpoints = Array.from(this.checkpoints.values());
    const now = Date.now();

    return {
      total: checkpoints.length,
      toolConversations: checkpoints.filter(cp => cp.toolCalls && cp.toolCalls.length > 0).length,
      oldestAge: checkpoints.length > 0 ? now - Math.min(...checkpoints.map(cp => cp.timestamp)) : 0,
      newestAge: checkpoints.length > 0 ? now - Math.max(...checkpoints.map(cp => cp.timestamp)) : 0
    };
  }

  /**
   * Cleanup old checkpoints
   */
  private cleanupOldCheckpoints(): void {
    const now = Date.now();
    const checkpoints = Array.from(this.checkpoints.entries())
      .sort((a, b) => b[1].timestamp - a[1].timestamp);

    // Remove checkpoints older than TTL
    for (const [id, checkpoint] of checkpoints) {
      if (now - checkpoint.timestamp > this.checkpointTTL) {
        this.checkpoints.delete(id);
      }
    }

    // Keep only last N checkpoints
    if (this.checkpoints.size > this.maxCheckpoints) {
      const toDelete = checkpoints.slice(this.maxCheckpoints);
      for (const [id] of toDelete) {
        this.checkpoints.delete(id);
      }
    }
  }
}

export const conversationStateManager = new ConversationStateManager();
