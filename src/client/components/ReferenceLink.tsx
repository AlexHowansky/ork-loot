import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { formatMoney } from "../../shared/money.ts";
import { referenceSiteFor } from "../../shared/reference-sites.ts";
import type { CampaignInfo, ReferenceMatch } from "../../shared/types.ts";
import { useReferenceSearch } from "../queries.ts";
import { Field, withError } from "./Field.tsx";

/** `value` once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/**
 * The loot link field. When the campaign's base reference URL is a site we
 * can search, items matching `name` are offered as suggestions while the
 * field has focus; picking one hands it to `onPick`.
 */
export function ReferenceLink({
  campaign,
  name,
  link,
  error,
  onChange,
  onPick,
}: {
  campaign: CampaignInfo;
  name: string;
  link: string;
  error?: string;
  onChange: (link: string) => void;
  onPick: (match: ReferenceMatch) => void;
}) {
  const site = referenceSiteFor(campaign.baseReferenceUrl);
  const query = useDebounced(name.trim(), 300);
  const search = useReferenceSearch(campaign.id, query, site !== undefined);
  const matches = search.data ?? [];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const shown = open && matches.length > 0;

  useEffect(() => setActive(-1), [search.data]);

  const pick = (m: ReferenceMatch) => {
    onPick(m);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!shown) {
      if (e.key === "ArrowDown" && matches.length > 0) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // Cycles through the matches and back to the typed link (-1).
      const n = matches.length + 1;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => ((i + 1 + step + n) % n) - 1);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(matches[active]!);
    } else if (e.key === "Escape") {
      // Close the suggestions without closing the dialog.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <>
      <Field
        label="Link"
        error={error}
        hint={site && search.isError ? `${site.host} couldn't be searched just now.` : undefined}
      >
        <input
          type="url"
          className={withError("input w-full", error)}
          placeholder={site ? `Optional; matches from ${site.host} appear here` : "Optional, e.g. https://…"}
          value={link}
          role={site ? "combobox" : undefined}
          aria-autocomplete={site ? "list" : undefined}
          aria-expanded={site ? shown : undefined}
          aria-controls={site ? listId : undefined}
          aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </Field>
      {shown && (
        <ul id={listId} role="listbox" aria-label="Matching items" className="menu w-full rounded-box bg-base-200 p-1">
          {matches.map((m, i) => (
            <li key={`${m.url}-${m.name}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                tabIndex={-1}
                className={`flex justify-between gap-4 ${i === active ? "menu-active" : ""}`}
                // Keep focus in the input so the list isn't closed by its blur.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(m)}
              >
                <span>
                  {m.name}
                  {m.level !== null && <span className="ml-2 text-base-content/60">Level {m.level}</span>}
                </span>
                <span className="tabular-nums">
                  {m.value !== null
                    ? formatMoney(m.value, campaign.currencyDecimals, campaign.currencyLabel)
                    : (m.priceLabel ?? "")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
