import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon, faXmark } from "./Icon.tsx";

/**
 * A themed modal on the native <dialog>. Escape, the close control and a
 * click on the backdrop all call `onClose`. The box is only as wide as its
 * content, up to the viewport.
 */
export function Modal({
  title,
  onClose,
  children,
  actions,
  onSubmit,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons for the modal-action row. */
  actions: ReactNode;
  /** When set, the body is a form and this handles its submission. */
  onSubmit?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const handle = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    dialog.addEventListener("cancel", handle);
    return () => dialog.removeEventListener("cancel", handle);
  }, []);

  const body = (
    <>
      <div className="flex items-start justify-between gap-4">
        <h3 id={titleId} className="text-lg font-bold">
          {title}
        </h3>
        <button
          type="button"
          className="btn btn-sm btn-circle btn-ghost -mr-2 -mt-1"
          aria-label="Close"
          onClick={() => close.current()}
        >
          <Icon icon={faXmark} />
        </button>
      </div>
      <div className="py-3">{children}</div>
      <div className="modal-action mt-2">{actions}</div>
    </>
  );

  return (
    <dialog ref={ref} className="modal" aria-labelledby={titleId}>
      {onSubmit ? (
        <form
          className="modal-box w-auto max-w-[calc(100vw-2rem)]"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {body}
        </form>
      ) : (
        <div className="modal-box w-auto max-w-[calc(100vw-2rem)]">{body}</div>
      )}
      <div className="modal-backdrop" aria-hidden="true">
        <button type="button" tabIndex={-1} onClick={() => close.current()}>
          close
        </button>
      </div>
    </dialog>
  );
}
