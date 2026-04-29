import { useEffect, useRef, useState } from 'react';
import type { TaskMessage } from '@/types/task';
import { taskSseUrl } from '@/api/tasks';

/**
 * Subscription state for the live task event stream.
 *
 * `connected` flips to true once the SSE channel is open. `events` is the
 * accumulated, append-only list of events received since subscription
 * started — callers typically merge it with the historical events that
 * arrived via getTaskDetail().
 */
export interface TaskSseState {
  connected: boolean;
  events: TaskMessage[];
  error: string | null;
}

/**
 * Subscribe to /api/v1/app/tasks/sse/:sessionId via the browser EventSource.
 *
 * Pass `enabled = false` to disable the connection (e.g. for completed
 * tasks where there is nothing left to stream). Closing the component or
 * flipping `enabled` always tears the EventSource down.
 *
 * The backend pushes named events; some implementations also push to the
 * default `message` channel. We listen on both so we don't miss updates.
 */
export function useTaskSse(
  sessionId: string | undefined,
  enabled: boolean,
): TaskSseState {
  const [state, setState] = useState<TaskSseState>({
    connected: false,
    events: [],
    error: null,
  });
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId || !enabled) {
      return undefined;
    }
    setState({ connected: false, events: [], error: null });

    const url = taskSseUrl(sessionId);
    const es = new EventSource(url);
    sourceRef.current = es;

    es.onopen = () => {
      setState((s) => ({ ...s, connected: true, error: null }));
    };
    es.onerror = () => {
      // Browsers auto-reconnect; surface a soft warning but keep listening.
      setState((s) => ({ ...s, error: 'SSE 连接异常，浏览器将自动重连' }));
    };

    const ingest = (raw: string) => {
      try {
        const parsed = JSON.parse(raw) as Partial<TaskMessage> & {
          event?: Record<string, unknown>;
          type?: string;
          sessionId?: string;
        };
        const msg: TaskMessage = {
          id: (parsed.id as string) || cryptoRandomId(),
          type: parsed.type || 'unknown',
          timestamp:
            (parsed.timestamp as number) ||
            (parsed.event &&
              (parsed.event as { timestamp?: number }).timestamp) ||
            Date.now(),
          event: (parsed.event as Record<string, unknown>) || (parsed as Record<string, unknown>),
        };
        setState((s) => ({ ...s, events: [...s.events, msg] }));
      } catch {
        // Ignore malformed payloads.
      }
    };

    es.onmessage = (e: MessageEvent<string>) => ingest(e.data);

    // The Go backend emits named events for each task event type; subscribe
    // to all currently known channels.
    const NAMED_EVENTS = [
      'liveStatus',
      'planUpdate',
      'newPlanStep',
      'statusUpdate',
      'toolUsed',
      'actionLog',
      'resultUpdate',
      'taskMessage',
      'task',
      'event',
    ];
    const namedHandler = (e: MessageEvent<string>) => ingest(e.data);
    for (const name of NAMED_EVENTS) {
      es.addEventListener(name, namedHandler as EventListener);
    }

    return () => {
      for (const name of NAMED_EVENTS) {
        es.removeEventListener(name, namedHandler as EventListener);
      }
      es.close();
      sourceRef.current = null;
    };
  }, [sessionId, enabled]);

  return state;
}

function cryptoRandomId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) {
      out += bytes[i].toString(16).padStart(2, '0');
    }
    return out;
  }
  // Local-only correlation id used to dedupe events; if no Web Crypto is
  // available, derive a stable id from the current time + a counter
  // captured on the function object. This is non-cryptographic, but the
  // value is never used as an authenticated identifier.
  const fn = cryptoRandomId as unknown as { _seq?: number };
  fn._seq = (fn._seq ?? 0) + 1;
  return `evt-${Date.now().toString(36)}-${fn._seq}`;
}
