import { useState } from "react";
import { Link, useLocation } from "react-router";
import { api, errorMessage, fieldErrors } from "../api.ts";
import { Field, FormError, withError } from "../components/Field.tsx";

export function ForgotPasswordPage() {
  const location = useLocation();
  const [email, setEmail] = useState<string>(location.state?.email ?? "");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const fields = fieldErrors(error);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/forgot", { email });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="card bg-base-100 shadow mx-auto mt-8 w-full max-w-sm">
        <div className="card-body">
          <h1 className="card-title">Check your email</h1>
          <p>
            If {email.trim()} belongs to a GM, we've sent it a link to choose a new
            password. The link works for an hour.
          </p>
          <div className="card-actions justify-end mt-2">
            <Link to="/login" className="btn">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="card bg-base-100 shadow mx-auto mt-8 w-full max-w-sm">
      <div className="card-body">
        <h1 className="card-title">Forgot password</h1>
        <p className="text-sm">Enter your email address and we'll send you a link to choose a new password.</p>
        <FormError message={error && !Object.keys(fields).length ? errorMessage(error) : null} />
        <Field label="Email address" error={fields.email}>
          <input
            type="email"
            className={withError("input w-full", fields.email)}
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <div className="card-actions justify-end mt-2">
          <Link to="/login" className="btn btn-ghost">
            Cancel
          </Link>
          <button className="btn btn-primary" disabled={busy}>
            {busy && <span className="loading loading-spinner loading-sm" />}
            Send reset link
          </button>
        </div>
      </div>
    </form>
  );
}
