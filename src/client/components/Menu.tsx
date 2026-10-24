import { useRef, type ReactNode } from "react";

/** A dropdown menu that closes once an item is chosen or focus leaves. */
export function Menu({
  label,
  children,
  buttonClass = "btn btn-sm",
  menuClass = "w-52",
  align = "end",
  ariaLabel,
}: {
  label: ReactNode;
  children: ReactNode;
  buttonClass?: string;
  menuClass?: string;
  /** Which edge of the button the menu lines up with. */
  align?: "start" | "end";
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute("open");
  return (
    <details
      ref={ref}
      className={`dropdown ${align === "end" ? "dropdown-end" : "dropdown-start"}`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <summary className={buttonClass} aria-label={ariaLabel}>{label}</summary>
      <ul className={`dropdown-content menu bg-base-100 text-base-content rounded-box z-20 p-2 shadow ${menuClass}`} onClick={close}>
        {children}
      </ul>
    </details>
  );
}
