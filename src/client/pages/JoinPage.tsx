import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../api.ts";
import { keys } from "../queries.ts";
import { Field, withError } from "../components/Field.tsx";

function fromFragment(hash: string) {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return "";
  }
}

/**
 * The join code input and its button, for embedding in any card body. A
 * join link carries its code in the URL fragment and joins straight away;
 * if that fails, the code stays in the box beside the error.
 */
export function JoinForm() {
  const { pathname, hash } = useLocation();
  const [code, setCode] = useState(() => fromFragment(hash));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Strict Mode runs effects twice; a code must only be redeemed once.
  const linkTried = useRef(false);

  async function join(value: string, replace = false) {
    setBusy(true);
    setError(null);
    try {
      // A code is for either a character or an observer.
      const joined = await api.post<{ characterId: string } | { observerId: string }>("/api/join", { code: value });
      await qc.invalidateQueries({ queryKey: keys.me });
      navigate("characterId" in joined ? `/play/${joined.characterId}` : `/watch/${joined.observerId}`, {
        replace,
      });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (linkTried.current || !code.trim()) return;
    linkTried.current = true;
    // Drop the code from the address, so going back or reloading doesn't
    // try a code that's now used up.
    navigate(pathname, { replace: true });
    void join(code, true);
    // Only for the code the page was opened with.
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void join(code);
  }

  const message = error ? errorMessage(error) : undefined;
  return (
    <form onSubmit={submit} noValidate>
      <Field label="Join code" error={message}>
        <input
          className={withError("input w-full font-mono uppercase tracking-widest", message)}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="ABCDE-FGHJK"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>
      <div className="card-actions justify-end mt-2">
        <button className="btn btn-primary" disabled={busy || !code.trim()}>
          {busy && <span className="loading loading-spinner loading-sm" />}
          Join
        </button>
      </div>
    </form>
  );
}

export function JoinPage() {
  return (
    <div className="card bg-base-100 shadow mx-auto mt-8 w-full max-w-sm">
      <div className="card-body">
        <h1 className="card-title">Join a campaign</h1>
        <p className="text-sm text-base-content/70">
          Your GM will give you a code for your character, or one to observe the campaign.
        </p>
        <JoinForm />
      </div>
    </div>
  );
}
