import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage, fieldErrors } from "../api.ts";
import { keys } from "../queries.ts";
import { Field, FormError, withError } from "../components/Field.tsx";
import type { Me } from "../../shared/types.ts";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fields = fieldErrors(error);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<Me>("/api/auth/login", { username, password });
      qc.setQueryData(keys.me, me);
      navigate("/");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="card bg-base-100 shadow mx-auto mt-8 w-full max-w-sm">
      <div className="card-body">
        <h1 className="card-title">GM sign in</h1>
        <FormError message={error && !Object.keys(fields).length ? errorMessage(error) : null} />
        <Field label="Username" error={fields.username}>
          <input
            className={withError("input w-full", fields.username)}
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field label="Password" error={fields.password}>
          <input
            type="password"
            className={withError("input w-full", fields.password)}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <div className="card-actions justify-end mt-2">
          <button className="btn btn-primary" disabled={busy}>
            {busy && <span className="loading loading-spinner loading-sm" />}
            Sign in
          </button>
        </div>
      </div>
    </form>
  );
}
