type WsEventHandler = (data: Record<string, unknown>) => void;

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/api/ws";

class WebSocketClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private handlers: Map<string, Set<WsEventHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  connect(token: string) {
    this.token = token;
    this.cleanup();

    this.ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);

    this.ws.onopen = () => {
      this.startPing();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as Record<string, unknown>;
        const type = data.type as string;
        this.handlers.get(type)?.forEach((handler) => handler(data));
        this.handlers.get("*")?.forEach((handler) => handler(data));
      } catch {
        // ignore malformed payloads
      }
    };

    this.ws.onclose = () => {
      this.stopPing();
      if (this.token) {
        this.reconnectTimer = setTimeout(() => {
          if (this.token) this.connect(this.token);
        }, 3000);
      }
    };
  }

  disconnect() {
    this.token = null;
    this.cleanup();
  }

  on(event: string, handler: WsEventHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  send(payload: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  sendTyping(conversationId: number) {
    this.send({ type: "typing", conversation_id: conversationId });
  }

  sendMessage(conversationId: number, content: string) {
    this.send({ type: "message", conversation_id: conversationId, content });
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
      this.ws.close();
      this.ws = null;
    }
  }
}

export const wsClient = new WebSocketClient();
