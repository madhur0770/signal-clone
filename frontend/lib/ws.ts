type WsEventHandler = (data: Record<string, unknown>) => void;

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/api/ws";

const BASE_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 15000;

/**
 * Thin wrapper around a WebSocket that reconnects with backoff.
 *
 * Besides the server's own events it emits two synthetic ones: `open` (with
 * `reconnect: true` when this isn't the first connection, so callers can re-sync
 * whatever they missed while offline) and `close`.
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private handlers: Map<string, Set<WsEventHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private attempts = 0;
  private hasConnectedBefore = false;

  connect(token: string) {
    this.token = token;
    this.cleanup();
    this.hasConnectedBefore = false;
    this.attempts = 0;
    this.open();
  }

  private open() {
    if (!this.token) return;
    const socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(this.token)}`);
    this.ws = socket;

    socket.onopen = () => {
      const reconnect = this.hasConnectedBefore;
      this.hasConnectedBefore = true;
      this.attempts = 0;
      this.startPing();
      this.emit("open", { type: "open", reconnect });
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as Record<string, unknown>;
        this.emit(data.type as string, data);
        this.emit("*", data);
      } catch {
        // ignore malformed payloads
      }
    };

    socket.onclose = () => {
      this.stopPing();
      this.emit("close", { type: "close" });
      if (this.token && this.ws === socket) {
        const delay = Math.min(BASE_RECONNECT_MS * 2 ** this.attempts, MAX_RECONNECT_MS);
        this.attempts += 1;
        this.reconnectTimer = setTimeout(() => this.open(), delay);
      }
    };
  }

  disconnect() {
    this.token = null;
    this.cleanup();
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  on(event: string, handler: WsEventHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  send(payload: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  sendTyping(conversationId: number) {
    this.send({ type: "typing", conversation_id: conversationId });
  }

  private emit(event: string, data: Record<string, unknown>) {
    this.handlers.get(event)?.forEach((handler) => handler(data));
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, 25000);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private cleanup() {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

export const wsClient = new WebSocketClient();
