import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Modal } from "./Modal.tsx";

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  /** Names the action, e.g. "Delete campaign". Never just "OK". */
  confirmLabel: string;
  danger?: boolean;
}

type Ask = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

/** Provides `useConfirm()`, the app's themed replacement for the browser's confirm dialog. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null);

  const ask = useCallback<Ask>(
    (opts) => new Promise((resolve) => setPending({ ...opts, resolve })),
    [],
  );

  const finish = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <ConfirmContext value={ask}>
      {children}
      {pending && (
        <Modal
          title={pending.title}
          onClose={() => finish(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => finish(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${pending.danger ? "btn-error" : "btn-primary"}`}
                data-autofocus
                onClick={() => finish(true)}
              >
                {pending.confirmLabel}
              </button>
            </>
          }
        >
          <div className="max-w-md">{pending.message}</div>
        </Modal>
      )}
    </ConfirmContext>
  );
}

export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm must be used inside ConfirmProvider");
  return ask;
}
