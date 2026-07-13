import type { Response } from 'express';

export type SseEvent =
  | { type: 'log'; message: string; at: string }
  | { type: 'result'; display: string; found: boolean; raw: string; at: string }
  | { type: 'passStart'; at: string }
  | { type: 'status'; running: boolean; message?: string; at: string }
  | { type: 'error'; message: string; at: string };

const clients = new Set<Response>();

export function addSseClient(res: Response): void {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function broadcast(event: SseEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(data);
    } catch {
      clients.delete(res);
    }
  }
}

export function emitLog(message: string): void {
  broadcast({ type: 'log', message, at: new Date().toISOString() });
}
