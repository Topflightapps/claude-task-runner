import { useCallback, useRef, useSyncExternalStore } from "react";

import type { WsMessage } from "../types.ts";

interface WsState {
  connected: boolean;
  lines: { line: string; runId: number; stream: string; ts?: string }[];
  reviewVersion: number;
}

const MAX_LINES = 2000;

export function useWebSocket(token: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const stateRef = useRef<WsState>({
    connected: false,
    lines: [],
    reviewVersion: 0,
  });
  const listenersRef = useRef<Set<() => void>>(new Set<() => void>());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const backoffRef = useRef(1000);

  const notify = useCallback(() => {
    for (const listener of listenersRef.current) {
      listener();
    }
  }, []);

  const connect = useCallback(() => {
    if (!token || wsRef.current?.readyState === WebSocket.OPEN) return;

    wsRef.current?.close();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws?token=${token}`,
    );
    wsRef.current = ws;

    ws.onopen = () => {
      stateRef.current = { ...stateRef.current, connected: true };
      backoffRef.current = 1000;
      notify();
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as WsMessage;
      if (msg.type === "output") {
        const newLines = [
          ...stateRef.current.lines,
          { runId: msg.runId, stream: msg.stream, line: msg.line, ts: msg.ts },
        ];
        if (newLines.length > MAX_LINES) {
          newLines.splice(0, newLines.length - MAX_LINES);
        }
        stateRef.current = { ...stateRef.current, lines: newLines };
        notify();
      } else if (msg.type === "status" || msg.type === "queue") {
        notify();
      } else if (msg.type === "review:output") {
        // Output events are just log lines — notify for LogViewer but don't bump version
        notify();
      } else if (msg.type === "review:status" || msg.type === "review:queue") {
        stateRef.current = {
          ...stateRef.current,
          reviewVersion: stateRef.current.reviewVersion + 1,
        };
        notify();
      }
    };

    ws.onclose = () => {
      stateRef.current = { ...stateRef.current, connected: false };
      notify();
      // Reconnect with exponential backoff
      reconnectTimerRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, 30000);
        connect();
      }, backoffRef.current);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [token, notify]);

  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimerRef.current);
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const clearLines = useCallback(() => {
    stateRef.current = { ...stateRef.current, lines: [] };
    notify();
  }, [notify]);

  const subscribe = useCallback(
    (listener: () => void) => {
      listenersRef.current.add(listener);

      // Connect on first subscriber
      if (listenersRef.current.size === 1) {
        connect();
      }

      return () => {
        listenersRef.current.delete(listener);
        if (listenersRef.current.size === 0) {
          disconnect();
        }
      };
    },
    [connect, disconnect],
  );

  const getSnapshot = useCallback(() => stateRef.current, []);

  const state = useSyncExternalStore(subscribe, getSnapshot);

  return { ...state, clearLines };
}
