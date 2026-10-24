import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage, fieldErrors } from "../api.ts";
import { keys } from "../queries.ts";
import { Field, FormError, withError } from "../components/Field.tsx";
import { MIN_PASSWORD } from "../../shared/schemas.ts";
import type { Me } from "../../shared/types.ts";

/**
 * Where a reset link lands. The token is in the URL fragment, so it never
 * reaches server logs or another site's Referer header.
 */
export function ResetPasswordPage() {
  const token = useLocation().hash.slice(1);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [mismatch, setMismatch] = useState<string>();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fields = fieldErrors(error);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== repeat) {
      setMismatch("The passwords don't match.");
      return;
    }
    setMismatch(undefined);
    setBusy(true);
    try {
      const me = await api.post<Me>("/api/auth/reset", { token, password });
      qc.setQueryData(keys.me, me);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="card bg-base-100 shadow mx-auto mt-8 w-full max-w-sm">
        <div className="card-body">
          <h1 className="card-title">Reset password</h1>
          <p>This link is incomplete. Open the link from the email again, or ask for a new one.</p>
          <div className="card-actions justify-end mt-2">
            <Link to="/forgot" className="btn btn-primary">
              Ask for a new link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="card bg-base-100 shadow mx-auto mt-8 w-full max-w-sm">
      <div className="card-body">
        <h1 className="card-title">Choose a new password</h1>
        <FormError message={error && !Object.keys(fields).length ? errorMessage(error) : null} />
        <Field
          label="New password"
          error={fields.password}
          hint={`At least ${MIN_PASSWORD} characters.`}
        >
          <input
            type="password"
            className={withError("input w-full", fields.password)}
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Repeat new password" error={mismatch}>
          <input
            type="password"
            className={withError("input w-full", mismatch)}
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </Field>
        <div className="card-actions justify-end mt-2">
          <button className="btn btn-primary" disabled={busy}>
            {busy && <span className="loading loading-spinner loading-sm" />}
            Save password
          </button>
        </div>
      </div>
    </form>
  );
}
