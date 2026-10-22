import { cloneElement, useId, type ReactElement } from "react";

/**
 * A labelled form control with its validation message. The single child
 * control is given an id, so the label and message are tied to it for
 * assistive technology.
 */
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  const control = cloneElement(children, {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": note ? noteId : undefined,
  });
  return (
    <div className="fieldset py-1">
      <label htmlFor={id} className="fieldset-legend pb-1">
        {label}
      </label>
      {control}
      {note && (
        <p id={noteId} className={`label whitespace-normal ${error ? "text-error" : ""}`}>
          {note}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="alert alert-error alert-soft mb-2 py-2">
      <span>{message}</span>
    </div>
  );
}

/** Adds the error colour to a control's class when it has an error. */
export const withError = (base: string, error?: string) =>
  error ? `${base} ${base.split(" ")[0]}-error` : base;
