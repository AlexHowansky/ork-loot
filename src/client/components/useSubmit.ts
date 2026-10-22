import { useState } from "react";
import { errorMessage, fieldErrors } from "../api.ts";

/** Busy and error state for a form that submits to the API. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = fieldErrors(error);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    fields,
    message: error ? errorMessage(error) : null,
    hasFieldErrors: Object.keys(fields).length > 0,
    run,
    fail: setError,
  };
}
