import { Response } from 'express';
import { Message } from './store';

export interface SSEClient {
  id: string;
  res: Response;
}

class SSEManager {
  private clients: Map<string, SSEClient> = new Map();

  // Add a new SSE client
  addClient(id: string, res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // Send initial connection message
    this.sendEvent(res, 'connected', { clientId: id });

    this.clients.set(id, { id, res });

    // Remove client on connection close
    res.on('close', () => {
      this.clients.delete(id);
    });
  }

  // Broadcast a message to all clients
  broadcastMessage(message: Message): void {
    this.broadcast('message', message);
  }

  // Broadcast a join event
  broadcastJoin(name: string, type: 'human' | 'agent'): void {
    this.broadcast('join', { name, type });
  }

  // Broadcast a leave event
  broadcastLeave(name: string): void {
    this.broadcast('leave', { name });
  }

  // Broadcast mute event
  broadcastMute(name: string, duration: number): void {
    this.broadcast('mute', { name, duration });
  }

  // Broadcast kick event
  broadcastKick(name: string): void {
    this.broadcast('kick', { name });
  }

  // Broadcast generic event
  broadcastEvent(eventType: string, data: any): void {
    this.broadcast(eventType, data);
  }

  // Generic broadcast method
  private broadcast(event: string, data: any): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    this.clients.forEach(client => {
      try {
        client.res.write(payload);
      } catch (error) {
        console.error(`Error sending to client ${client.id}:`, error);
        this.clients.delete(client.id);
      }
    });
  }

  // Send event to specific client
  private sendEvent(res: Response, event: string, data: any): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(payload);
  }

  // Get active client count
  getClientCount(): number {
    return this.clients.size;
  }
}

export const sseManager = new SSEManager();
