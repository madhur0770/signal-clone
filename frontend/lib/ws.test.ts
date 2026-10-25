import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebSocketClient } from "./ws";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  serverClose() {
    this.readyState = 3;
    this.onclose?.();
  }
  push(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("WebSocketClient", () => {
  it("connects with the token in the query string", () => {
    const client = new WebSocketClient();
    client.connect("a b+c");
    expect(FakeSocket.instances[0].url).toContain("?token=a%20b%2Bc");
  });

  it("routes events by type and to wildcard listeners", () => {
    const client = new WebSocketClient();
    const onMessage = vi.fn();
    const onAny = vi.fn();
    client.on("message", onMessage);
    client.on("*", onAny);
    client.connect("t");
    FakeSocket.instances[0].open();

    FakeSocket.instances[0].push({ type: "message", message: { id: 1 } });
    FakeSocket.instances[0].push({ type: "typing" });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onAny).toHaveBeenCalledTimes(2);
  });

  it("ignores malformed frames", () => {
    const client = new WebSocketClient();
    const onAny = vi.fn();
    client.on("*", onAny);
    client.connect("t");
    FakeSocket.instances[0].onmessage?.({ data: "not json" });
    expect(onAny).not.toHaveBeenCalled();
  });

  it("flags only later opens as reconnects", () => {
    const client = new WebSocketClient();
    const onOpen = vi.fn();
    client.on("open", onOpen);
    client.connect("t");
    FakeSocket.instances[0].open();
    expect(onOpen).toHaveBeenLastCalledWith({ type: "open", reconnect: false });

    FakeSocket.instances[0].serverClose();
    vi.advanceTimersByTime(1000);
    FakeSocket.instances[1].open();
    expect(onOpen).toHaveBeenLastCalledWith({ type: "open", reconnect: true });
  });

  it("backs off between reconnect attempts and resets after success", () => {
    const client = new WebSocketClient();
    client.connect("t");

    FakeSocket.instances[0].serverClose();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);

    FakeSocket.instances[1].serverClose(); // second failure waits twice as long
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);

    FakeSocket.instances[2].open();
    FakeSocket.instances[2].serverClose();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it("stops reconnecting after disconnect()", () => {
    const client = new WebSocketClient();
    client.connect("t");
    FakeSocket.instances[0].open();
    client.disconnect();
    vi.advanceTimersByTime(60000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("sends typing events and pings only while open", () => {
    const client = new WebSocketClient();
    client.connect("t");
    client.sendTyping(4); // still connecting: dropped
    const socket = FakeSocket.instances[0];
    expect(socket.sent).toEqual([]);

    socket.open();
    client.sendTyping(4);
    expect(JSON.parse(socket.sent[0])).toEqual({ type: "typing", conversation_id: 4 });

    vi.advanceTimersByTime(25000);
    expect(JSON.parse(socket.sent[1])).toEqual({ type: "ping" });
  });

  it("lets listeners unsubscribe", () => {
    const client = new WebSocketClient();
    const handler = vi.fn();
    const off = client.on("typing", handler);
    client.connect("t");
    off();
    FakeSocket.instances[0].push({ type: "typing" });
    expect(handler).not.toHaveBeenCalled();
  });
});
