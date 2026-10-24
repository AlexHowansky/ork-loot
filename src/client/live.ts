import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api, CLIENT_ID } from "./api.ts";
import { keys } from "./queries.ts";
import { useToast } from "./components/Toast.tsx";
import type { LiveNotice, Me } from "../shared/types.ts";

/** A toast describing what someone in another tab did. */
export function noticeText(n: LiveNotice): string {
  const what = n.quantity > 1 ? `${n.quantity} × ${n.item}` : n.item;
  if (n.byGm) {
    return n.kind === "claimed"
      ? `The GM claimed ${what} on behalf of ${n.character}.`
      : `The GM released ${what} back to the pool on behalf of ${n.character}.`;
  }
  return n.kind === "claimed"
    ? `${n.character} claimed ${what}.`
    : `${n.character} released ${what} back to the pool.`;
}

/**
 * Keeps queries fresh from a Server-Sent Events stream: each "changed"
 * event refetches them, except for changes this tab made itself, which it
 * already refetches. Claims and releases from elsewhere also show a toast.
 * EventSource reconnects on its own; a reconnect refetches too, in case
 * something changed in between. When the GM is signed out everywhere, as
 * by a password reset, the stream says so before it ends: a browser that
 * signed back in carries on, and any other goes back to the start.
 */
export function useLiveUpdates(url: string, queryKeys: QueryKey[]) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;

  useEffect(() => {
    const source = new EventSource(url);
    const refresh = () => {
      for (const queryKey of keysRef.current) qc.invalidateQueries({ queryKey });
    };
    let opened = false;
    source.onopen = () => {
      if (opened) refresh();
      opened = true;
    };
    source.addEventListener("changed", (e) => {
      let origin: unknown = null;
      let notices: LiveNotice[] = [];
      try {
        const data = JSON.parse((e as MessageEvent<string>).data);
        origin = data.origin;
        if (Array.isArray(data.notices)) notices = data.notices;
      } catch {
        // Treat a garbled event as someone else's change.
      }
      if (origin === CLIENT_ID) return;
      refresh();
      for (const n of notices) toast(noticeText(n), "info");
    });
    source.addEventListener("signedout", async () => {
      let me: Me | null = null;
      try {
        me = await qc.fetchQuery({ queryKey: keys.me, queryFn: () => api.get<Me>("/api/auth/me") });
      } catch {
        // Can't tell; the reconnect will answer it.
      }
      if (me && !me.gm) {
        source.close();
        qc.clear();
        navigate("/");
        toast("You've been signed out because your password was changed.", "info");
      }
    });
    return () => source.close();
  }, [url, qc, toast, navigate]);
}
