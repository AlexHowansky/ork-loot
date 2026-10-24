import { useEffect, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { CLIENT_ID } from "./api.ts";
import { useToast } from "./components/Toast.tsx";
import type { LiveNotice } from "../shared/types.ts";

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
 * something changed in between.
 */
export function useLiveUpdates(url: string, queryKeys: QueryKey[]) {
  const qc = useQueryClient();
  const toast = useToast();
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
    return () => source.close();
  }, [url, qc, toast]);
}
