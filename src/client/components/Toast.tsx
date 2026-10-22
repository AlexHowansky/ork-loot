import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Kind = "success" | "error" | "info";
interface Item {
  id: number;
  kind: Kind;
  message: string;
}

const ToastContext = createContext<((message: string, kind?: Kind) => void) | null>(null);

const ALERT: Record<Kind, string> = {
  success: "alert-success",
  error: "alert-error",
  info: "alert-info",
};

let next = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const show = useCallback((message: string, kind: Kind = "success") => {
    const id = next++;
    setItems((xs) => [...xs, { id, kind, message }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastContext value={show}>
      {children}
      <div className="toast toast-end z-50" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className={`alert ${ALERT[t.kind]}`}>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside ToastProvider");
  return show;
}
