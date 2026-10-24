import { useEffect, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { CLIENT_ID } from "./api.ts";

/**
 * Keeps queries fresh from a Server-Sent Events stream: each "changed"
 * event refetches them, except for changes this tab made itself, which it
 * already refetches. EventSource reconnects on its own; a reconnect
 * refetches too, in case something changed in between.
 */
export function useLiveUpdates(url: string, queryKeys: QueryKey[]) {
  const qc = useQueryClient();
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
      try {
        origin = JSON.parse((e as MessageEvent<string>).data).origin;
      } catch {
        // Treat a garbled event as someone else's change.
      }
      if (origin !== CLIENT_ID) refresh();
    });
    return () => source.close();
  }, [url, qc]);
}
