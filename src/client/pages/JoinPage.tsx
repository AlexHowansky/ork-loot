import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../api.ts";
import { keys } from "../queries.ts";
import { Field, withError } from "../components/Field.tsx";

/** The join code input and its button, for embedding in any card body. */
export function JoinForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // A code is for either a character or an observer.
      const joined = await api.post<{ characterId: string } | { observerId: string }>("/api/join", { code });
      await qc.invalidateQueries({ queryKey: keys.me });
      navigate("characterId" in joined ? `/play/${joined.characterId}` : `/watch/${joined.observerId}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
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
