import { SECURITY_HEADERS, type Ctx } from "./http.ts";
import { logger } from "./logger.ts";

/** Called with the client id of whoever made the change, if known. */
type Listener = (origin: string | null) => void;

/**
 * Tells open browsers that a campaign changed. It lives in memory, so it
 * only reaches streams held by this process.
 */
export function createEventBus() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    subscribe(campaignId: string, fn: Listener): () => void {
      let set = listeners.get(campaignId);
      if (!set) listeners.set(campaignId, (set = new Set()));
      set.add(fn);
      return () => {
        set.delete(fn);
        if (set.size === 0) listeners.delete(campaignId);
      };
    },
    publish(campaignId: string, origin: string | null) {
      for (const fn of listeners.get(campaignId) ?? []) fn(origin);
    },
    count(campaignId: string): number {
      return listeners.get(campaignId)?.size ?? 0;
    },
  };
}

export type EventBus = ReturnType<typeof createEventBus>;

/** Comments keep proxies from closing a quiet stream. */
const PING_MS = 25_000;

/**
 * A Server-Sent Events stream that says "changed" whenever the campaign
 * does. It carries no data: each browser refetches its own view, so
 * nothing reaches a player that their normal view wouldn't show.
 */
export function sseResponse(ctx: Ctx, campaignId: string): Response {
  ctx.keepOpen();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = ctx.events.subscribe(campaignId, (origin) =>
        send(`event: changed\ndata: ${JSON.stringify({ origin })}\n\n`),
      );
      const ping = setInterval(() => send(": ping\n\n"), PING_MS);
      const onAbort = () => cleanup();
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
        ctx.req.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
        logger.debug("live stream closed", {
          requestId: ctx.requestId,
          campaignId,
          listeners: ctx.events.count(campaignId),
        });
      };
      ctx.req.signal.addEventListener("abort", onAbort);
      // Sending something at once lets the browser see the stream open.
      send(": connected\n\n");
      logger.debug("live stream opened", {
        requestId: ctx.requestId,
        campaignId,
        listeners: ctx.events.count(campaignId),
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
