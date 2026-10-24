import { SECURITY_HEADERS, type Ctx } from "./http.ts";
import { logger } from "./logger.ts";
import type { LiveNotice } from "../../shared/types.ts";

/**
 * Called with the client id of whoever made the change, if known, and
 * anything worth telling the other tabs about it.
 */
type Listener = (origin: string | null, notices: LiveNotice[]) => void;

interface Subscriber {
  fn: Listener;
  /** Hears GM-only changes too, such as who is online. */
  gm: boolean;
  /** The GM whose login opened it, so it can be ended with their logins. */
  gmId?: string;
  /** Ends the stream when its GM is signed out everywhere. */
  end?: () => void;
}

/** A player's open stream, which marks their character online. */
export interface Presence {
  characterId: string;
  playerId: number;
}

/**
 * Tells open browsers that a campaign changed. It lives in memory, so it
 * only reaches streams held by this process. It also counts each player's
 * open streams per character, which is what makes a character online.
 */
export function createEventBus() {
  const listeners = new Map<string, Set<Subscriber>>();
  /** Character id → player id → open streams. */
  const present = new Map<string, Map<number, number>>();

  function publish(
    campaignId: string,
    origin: string | null,
    notices: LiveNotice[] = [],
    opts: { gmOnly?: boolean } = {},
  ) {
    for (const s of listeners.get(campaignId) ?? []) {
      if (s.gm || !opts.gmOnly) s.fn(origin, notices);
    }
  }

  return {
    subscribe(
      campaignId: string,
      fn: Listener,
      opts: { gm?: boolean; gmId?: string; end?: () => void } = {},
    ): () => void {
      let set = listeners.get(campaignId);
      if (!set) listeners.set(campaignId, (set = new Set()));
      const sub: Subscriber = { fn, gm: opts.gm ?? false, gmId: opts.gmId, end: opts.end };
      set.add(sub);
      return () => {
        set.delete(sub);
        if (set.size === 0) listeners.delete(campaignId);
      };
    },
    publish,
    /**
     * Ends every stream a GM has open, for when all their logins have
     * been ended, so no page keeps listening on a login that is gone.
     */
    signOut(gmId: string): number {
      const ending: (() => void)[] = [];
      for (const set of listeners.values()) {
        for (const s of set) if (s.gmId === gmId && s.end) ending.push(s.end);
      }
      for (const end of ending) end();
      return ending.length;
    },
    count(campaignId: string): number {
      return listeners.get(campaignId)?.size ?? 0;
    },
    /**
     * Marks a player as viewing their character until the returned
     * function is called. Only the GM sees who is online, so only GM
     * streams hear when that changes.
     */
    arrive(campaignId: string, { characterId, playerId }: Presence): () => void {
      let players = present.get(characterId);
      if (!players) present.set(characterId, (players = new Map()));
      const before = players.get(playerId) ?? 0;
      players.set(playerId, before + 1);
      if (before === 0) publish(campaignId, null, [], { gmOnly: true });
      let left = false;
      return () => {
        if (left) return;
        left = true;
        const n = (players.get(playerId) ?? 1) - 1;
        if (n > 0) {
          players.set(playerId, n);
          return;
        }
        players.delete(playerId);
        if (players.size === 0) present.delete(characterId);
        publish(campaignId, null, [], { gmOnly: true });
      };
    },
    /**
     * Whether this player has the character open. Asking about the
     * character's current player ignores a stream left open by one who
     * has since been signed out.
     */
    isOnline(characterId: string, playerId: number | null): boolean {
      return playerId !== null && (present.get(characterId)?.get(playerId) ?? 0) > 0;
    },
  };
}

export type EventBus = ReturnType<typeof createEventBus>;

/** Comments keep proxies from closing a quiet stream. */
const PING_MS = 25_000;

/**
 * A Server-Sent Events stream that says "changed" whenever the campaign
 * does. It carries no campaign data: each browser refetches its own view,
 * so nothing reaches a player that their normal view wouldn't show. The
 * only extra is a short notice of claims and releases, for a toast. A
 * GM's stream ends with "signedout" when their logins are all ended.
 */
export function sseResponse(
  ctx: Ctx,
  campaignId: string,
  opts: { gm: true; gmId: string } | { gm: false; presence: Presence },
): Response {
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
      const unsubscribe = ctx.events.subscribe(
        campaignId,
        (origin, notices) =>
          send(`event: changed\ndata: ${JSON.stringify({ origin, notices })}\n\n`),
        opts.gm
          ? {
              gm: true,
              gmId: opts.gmId,
              end: () => {
                // Tells the page why, before the browser tries to reconnect.
                send("event: signedout\ndata: {}\n\n");
                cleanup();
              },
            }
          : {},
      );
      const leave = opts.gm ? () => {} : ctx.events.arrive(campaignId, opts.presence);
      const ping = setInterval(() => send(": ping\n\n"), PING_MS);
      const onAbort = () => cleanup();
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
        leave();
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
