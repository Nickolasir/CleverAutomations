/**
 * Home Assistant WebSocket API client.
 *
 * Maintains a persistent WebSocket connection to HA for real-time
 * state_changed events. Reconnects with exponential backoff.
 * Emits typed events that the rest of the platform can subscribe to.
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type {
  Device,
  DeviceId,
  DeviceState,
  TenantId,
} from "@clever/shared";
import { mapHAState, entityIdToCategory } from "./rest-client.js";
import type { HAEntityState } from "./rest-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HAWebSocketClientConfig {
  /** WebSocket URL (e.g. ws://homeassistant.local:8123/api/websocket) */
  url: string;
  /** Long-lived access token */
  token: string;
  /** Tenant this connection belongs to */
  tenantId: TenantId;
  /** Maximum reconnect attempts before giving up (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectBaseDelayMs?: number;
  /** Maximum reconnect delay in ms (default: 30000) */
  reconnectMaxDelayMs?: number;
  /** Ping interval in ms (default: 30000) */
  pingIntervalMs?: number;
  /** Pong timeout in ms (default: 10000) */
  pongTimeoutMs?: number;
}

/** Emitted when a device state changes. */
export interface DeviceStateChangedEvent {
  entityId: string;
  deviceId: DeviceId;
  tenantId: TenantId;
  oldState: DeviceState;
  newState: DeviceState;
  attributes: Record<string, unknown>;
  timestamp: string;
}

/** Internal HA WebSocket message shapes. */
interface HAAuthRequiredMsg {
  type: "auth_required";
  ha_version: string;
}

interface HAAuthOkMsg {
  type: "auth_ok";
  ha_version: string;
}

interface HAAuthInvalidMsg {
  type: "auth_invalid";
  message: string;
}

interface HAResultMsg {
  id: number;
  type: "result";
  success: boolean;
  result: unknown;
  error?: { code: string; message: string };
}

interface HAEventMsg {
  id: number;
  type: "event";
  event: {
    event_type: string;
    data: {
      entity_id: string;
      old_state: HAEntityState | null;
      new_state: HAEntityState | null;
    };
    time_fired: string;
  };
}

interface HAPongMsg {
  id: number;
  type: "pong";
}

type HAIncomingMessage =
  | HAAuthRequiredMsg
  | HAAuthOkMsg
  | HAAuthInvalidMsg
  | HAResultMsg
  | HAEventMsg
  | HAPongMsg;

// ---------------------------------------------------------------------------
// Typed EventEmitter interface
// ---------------------------------------------------------------------------

export interface HAWebSocketClientEvents {
  connected: [];
  disconnected: [reason: string];
  authenticated: [haVersion: string];
  auth_failed: [message: string];
  state_changed: [event: DeviceStateChangedEvent];
  error: [error: Error];
  reconnecting: [attempt: number, delayMs: number];
}

export declare interface HAWebSocketClient {
  on<K extends keyof HAWebSocketClientEvents>(
    event: K,
    listener: (...args: HAWebSocketClientEvents[K]) => void,
  ): this;
  off<K extends keyof HAWebSocketClientEvents>(
    event: K,
    listener: (...args: HAWebSocketClientEvents[K]) => void,
  ): this;
  emit<K extends keyof HAWebSocketClientEvents>(
    event: K,
    ...args: HAWebSocketClientEvents[K]
  ): boolean;
}

// ---------------------------------------------------------------------------
// Client implementation
// ---------------------------------------------------------------------------

export class HAWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private isAuthenticated = false;

  private readonly url: string;
  private readonly token: string;
  private readonly tenantId: TenantId;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;

  constructor(config: HAWebSocketClientConfig) {
    super();
    this.url = config.url;
    this.token = config.token;
    this.tenantId = config.tenantId;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? Infinity;
    this.reconnectBaseDelayMs = config.reconnectBaseDelayMs ?? 1_000;
    this.reconnectMaxDelayMs = config.reconnectMaxDelayMs ?? 30_000;
    this.pingIntervalMs = config.pingIntervalMs ?? 30_000;
    this.pongTimeoutMs = config.pongTimeoutMs ?? 10_000;
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  /** Open the WebSocket connection. */
  connect(): void {
    this.intentionalClose = false;
    this.openSocket();
  }

  /** Gracefully close the connection. Does not reconnect. */
  disconnect(): void {
    this.intentionalClose = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
    this.isAuthenticated = false;
  }

  /** Whether the client is connected and authenticated. */
  get connected(): boolean {
    return (
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN &&
      this.isAuthenticated
    );
  }

  // -----------------------------------------------------------------------
  // Internal socket management
  // -----------------------------------------------------------------------

  private nextId(): number {
    this.msgId += 1;
    return this.msgId;
  }

  private send(data: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private openSocket(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.emit(
        "error",
        err instanceof Error ? err : new Error("Failed to create WebSocket"),
      );
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      this.emit("connected");
    });

    this.ws.on("message", (raw: WebSocket.RawData) => {
      this.handleMessage(raw);
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      this.isAuthenticated = false;
      this.clearTimers();
      const msg = reason.toString("utf-8") || `code ${code}`;
      this.emit("disconnected", msg);

      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", (err: Error) => {
      this.emit("error", err);
    });
  }

  private handleMessage(raw: WebSocket.RawData): void {
    let msg: HAIncomingMessage;
    try {
      msg = JSON.parse(raw.toString("utf-8")) as HAIncomingMessage;
    } catch {
      return; // Ignore unparseable frames
    }

    switch (msg.type) {
      case "auth_required":
        this.send({ type: "auth", access_token: this.token });
        break;

      case "auth_ok":
        this.isAuthenticated = true;
        this.reconnectAttempt = 0;
        this.emit("authenticated", msg.ha_version);
        this.subscribeToStateChanges();
        this.startPingPong();
        break;

      case "auth_invalid":
        this.emit("auth_failed", msg.message);
        this.intentionalClose = true; // Do not retry on bad credentials
        this.ws?.close(4001, "Auth invalid");
        break;

      case "event":
        this.handleEvent(msg);
        break;

      case "pong":
        this.clearPongTimer();
        break;

      case "result":
        // We could wire up a promise map for request/response patterns,
        // but state_changed subscription is fire-and-forget.
        if (!msg.success && msg.error) {
          this.emit(
            "error",
            new Error(`HA WS error: ${msg.error.code} - ${msg.error.message}`),
          );
        }
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Subscriptions
  // -----------------------------------------------------------------------

  private subscribeToStateChanges(): void {
    this.send({
      id: this.nextId(),
      type: "subscribe_events",
      event_type: "state_changed",
    });
  }

  private handleEvent(msg: HAEventMsg): void {
    const { data, time_fired } = msg.event;
    if (!data.new_state) return;

    const category = entityIdToCategory(data.entity_id);
    if (!category) return; // Ignore unsupported entity domains

    const oldState = data.old_state
      ? mapHAState(data.entity_id, data.old_state.state)
      : "unknown";
    const newState = mapHAState(data.entity_id, data.new_state.state);

    // Only emit if the canonical state actually changed
    if (oldState === newState) return;

    const event: DeviceStateChangedEvent = {
      entityId: data.entity_id,
      deviceId: data.entity_id as unknown as DeviceId,
      tenantId: this.tenantId,
      oldState,
      newState,
      attributes: { ...data.new_state.attributes },
      timestamp: time_fired,
    };

    this.emit("state_changed", event);
  }

  // -----------------------------------------------------------------------
  // Ping / pong keepalive
  // -----------------------------------------------------------------------

  private startPingPong(): void {
    this.clearTimers();
    this.pingTimer = setInterval(() => {
      this.sendPing();
    }, this.pingIntervalMs);
  }

  private sendPing(): void {
    const id = this.nextId();
    this.send({ id, type: "ping" });

    this.pongTimer = setTimeout(() => {
      // No pong received - connection is dead
      this.emit("error", new Error("Pong timeout - closing connection"));
      this.ws?.terminate();
    }, this.pongTimeoutMs);
  }

  private clearPongTimer(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Reconnection with exponential backoff
  // -----------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.emit(
        "error",
        new Error(
          `Exceeded max reconnect attempts (${this.maxReconnectAttempts})`,
        ),
      );
      return;
    }

    const delay = Math.min(
      this.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempt),
      this.reconnectMaxDelayMs,
    );
    const jitter = Math.random() * delay * 0.3;
    const totalDelay = Math.round(delay + jitter);

    this.reconnectAttempt += 1;
    this.emit("reconnecting", this.reconnectAttempt, totalDelay);

    this.reconnectTimer = setTimeout(() => {
      this.openSocket();
    }, totalDelay);
  }

  // -----------------------------------------------------------------------
  // Timer cleanup
  // -----------------------------------------------------------------------

  private clearTimers(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearPongTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
