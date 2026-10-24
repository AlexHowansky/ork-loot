import { useState } from "react";
import { api, errorMessage } from "../api.ts";
import { useRefresh } from "../queries.ts";
import type { CampaignView, LootView } from "../../shared/types.ts";
import { CHARACTER_STATUSES, LOOT_STATUSES, STATUS_LABEL, type LootStatus } from "../../shared/status.ts";
import { Money } from "./Money.tsx";
import { StatusBadge, StatusMenu } from "./StatusBadge.tsx";
import { LootForm } from "./LootForm.tsx";
import { ClaimForm, StatusCharacterForm } from "./SimpleForms.tsx";
import { useConfirm } from "./Confirm.tsx";
import { useToast } from "./Toast.tsx";
import {
  Icon,
  faArrowRotateLeft,
  faArrowUpRightFromSquare,
  faCircleQuestion,
  faHand,
  faMagnifyingGlass,
  faPen,
  faPlus,
  faSort,
  faSortDown,
  faSortUp,
  faTrash,
  faXmark,
} from "./Icon.tsx";
import type { Mode } from "./Board.tsx";

export type StatusFilter = "pool" | "available" | "history" | "all";

const FILTER: Record<StatusFilter, (s: LootStatus) => boolean> = {
  pool: (s) => s === "available" || s === "party" || s === "claimed",
  // Available items are in the pool and nobody has claimed them yet.
  available: (s) => s === "available",
  history: (s) => s === "sold" || s === "bought" || s === "abandoned",
  all: () => true,
};

const FILTER_LABEL: Record<StatusFilter, string> = {
  pool: "Pool",
  available: "Available",
  history: "Gone",
  all: "All",
};

/** Whose items to show: anyone's, nobody's, or one character's (by id). */
export type ClaimFilter = "all" | "none" | string;

export type SortKey = "name" | "quantity" | "value" | "marketPct" | "subtotal" | "status" | "claim" | "session";

export interface LootSort {
  key: SortKey;
  dir: "asc" | "desc";
}

export const DEFAULT_SORT: LootSort = { key: "name", dir: "asc" };

/** Orders item names alphabetically, ignoring case and reading digits as numbers. */
const byName = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Folds case and accents away, so a search for "elven" finds "Elvén". */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

export function LootTable({
  view,
  mode,
  sessionFilter,
  onSessionFilter,
  statusFilter,
  onStatusFilter,
  claimFilter,
  onClaimFilter,
  search,
  onSearch,
  onClear,
  sort,
  onSort,
}: {
  view: CampaignView;
  mode: Mode;
  sessionFilter: number | "all";
  onSessionFilter: (v: number | "all") => void;
  statusFilter: StatusFilter;
  onStatusFilter: (v: StatusFilter) => void;
  claimFilter: ClaimFilter;
  onClaimFilter: (v: ClaimFilter) => void;
  /** Text the item names must contain. */
  search: string;
  onSearch: (v: string) => void;
  /** Puts every filter back to its default. */
  onClear: () => void;
  sort: LootSort;
  onSort: (v: LootSort) => void;
}) {
  const { campaign } = view;
  const [editing, setEditing] = useState<LootView | "new" | null>(null);
  const [claiming, setClaiming] = useState<LootView | null>(null);
  const [assigning, setAssigning] = useState<{ item: LootView; status: "claimed" | "bought" } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const refresh = useRefresh();
  const ask = useConfirm();
  const toast = useToast();
  const gm = mode.kind === "gm";

  const sessionById = new Map(view.sessions.map((s) => [s.id, s]));
  const nameById = new Map(view.characters.map((c) => [c.id, c.name]));
  // Characters without shares can't claim loot.
  const claimants = view.characters.filter((c) => c.shares > 0);
  const canClaim = mode.kind === "gm" ? claimants.length > 0 : claimants.some((c) => c.id === mode.characterId);
  const needle = fold(search.trim());
  const filtered = statusFilter !== "pool" || sessionFilter !== "all" || claimFilter !== "all" || search !== "";
  // A character deleted while chosen leaves nothing to match, so show everyone's.
  const claimedBy =
    claimFilter === "all" || claimFilter === "none" || nameById.has(claimFilter) ? claimFilter : "all";
  // What each column sorts by; null is a blank or hidden cell, which sorts last either way.
  const sortValue: Record<SortKey, (l: LootView) => string | number | null> = {
    name: (l) => l.name,
    quantity: (l) => l.quantity,
    value: (l) => (l.unidentified && !gm ? null : l.value),
    marketPct: (l) => l.marketPct,
    subtotal: (l) => (l.unidentified && !gm ? null : l.subtotal),
    status: (l) => LOOT_STATUSES.indexOf(l.status),
    claim: (l) => (l.characterId !== null ? (nameById.get(l.characterId) ?? null) : null),
    session: (l) => sessionById.get(l.sessionId)?.date ?? null,
  };
  const keyOf = sortValue[sort.key];
  const sign = sort.dir === "asc" ? 1 : -1;
  const rows = view.loot
    .filter(
      (l) =>
        FILTER[statusFilter](l.status) &&
        (sessionFilter === "all" || l.sessionId === sessionFilter) &&
        (claimedBy === "all" || l.characterId === (claimedBy === "none" ? null : claimedBy)) &&
        (!needle || fold(l.name).includes(needle)),
    )
    .sort((a, b) => {
      const x = keyOf(a);
      const y = keyOf(b);
      const byKey =
        x === y
          ? 0
          : x === null
            ? 1
            : y === null
              ? -1
              : sign * (typeof x === "string" ? byName.compare(x, String(y)) : x - Number(y));
      // Ties fall back to name, then session, then entry order.
      return byKey || byName.compare(a.name, b.name) || a.sessionId - b.sessionId || a.id - b.id;
    });
  // Unidentified items count as nothing, as they do in the pool.
  const shownTotal = rows.reduce((n, l) => n + (l.unidentified ? 0 : l.subtotal), 0);

  async function act(item: LootView, action: () => Promise<unknown>, done: string) {
    setBusyId(item.id);
    try {
      await action();
      toast(done);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusyId(null);
      refresh();
    }
  }

  async function remove(item: LootView) {
    const ok = await ask({
      title: "Delete this item?",
      message: (
        <p>
          <strong>{item.name}</strong> will be removed for good. To record that it was sold or abandoned,
          change its status instead.
        </p>
      ),
      confirmLabel: "Delete item",
      danger: true,
    });
    if (ok) await act(item, () => api.del(`/api/loot/${item.id}`), `Deleted ${item.name}.`);
  }

  function claim(item: LootView) {
    if (mode.kind !== "player" || item.quantity > 1) {
      setClaiming(item);
      return;
    }
    act(
      item,
      () => api.post(`/api/play/${mode.characterId}/claim`, { lootId: item.id, quantity: 1 }),
      `Claimed ${item.name}.`,
    );
  }

  function release(item: LootView) {
    act(
      item,
      () =>
        mode.kind === "gm"
          ? api.post(`/api/loot/${item.id}/release`)
          : api.post(`/api/play/${mode.characterId}/release`, { lootId: item.id }),
      `Released ${item.name} back to the pool.`,
    );
  }

  /**
   * The GM changes an item's status from its pill. Claiming an available
   * item and releasing a claim work as their buttons do; a status that
   * needs a character the item doesn't have asks which one.
   */
  function changeStatus(item: LootView, status: LootStatus) {
    if (status === "claimed" && item.status === "available") {
      setClaiming(item);
      return;
    }
    if (status === "available" && item.status === "claimed") {
      release(item);
      return;
    }
    if (status === "claimed" || status === "bought") {
      const keeps =
        status === "claimed"
          ? claimants.some((c) => c.id === item.characterId)
          : item.characterId !== null && nameById.has(item.characterId);
      if (!keeps) {
        setAssigning({ item, status });
        return;
      }
    }
    act(
      item,
      () => api.patch(`/api/loot/${item.id}`, { status }),
      `Marked ${item.name} ${STATUS_LABEL[status].toLowerCase()}.`,
    );
  }

  // Claims need a character with shares; bought items any character.
  const unavailable = CHARACTER_STATUSES.filter((st) =>
    st === "claimed" ? !claimants.length : !view.characters.length,
  );

  const statusPill = (item: LootView, tip: "left" | "right" = "left") =>
    gm ? (
      <StatusMenu
        status={item.status}
        itemName={item.name}
        tip={tip}
        unavailable={unavailable}
        onChoose={(st) => changeStatus(item, st)}
      />
    ) : (
      <StatusBadge status={item.status} tip={tip} />
    );

  /** A column header that sorts the table; choosing it again reverses the order. */
  const sortHeader = (key: SortKey, label: string, className = "") => {
    const active = sort.key === key;
    return (
      <th className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
        <button
          type="button"
          className={`inline-flex cursor-pointer items-center gap-1 whitespace-nowrap hover:text-base-content ${active ? "text-base-content" : ""}`}
          onClick={() => onSort({ key, dir: active && sort.dir === "asc" ? "desc" : "asc" })}
        >
          <Icon
            icon={active ? (sort.dir === "asc" ? faSortUp : faSortDown) : faSort}
            className={active ? "" : "text-base-content/30"}
          />
          {label}
        </button>
      </th>
    );
  };

  const claimButton = (item: LootView) => (
    <button type="button" className="btn btn-xs" disabled={busyId === item.id} onClick={() => claim(item)}>
      <Icon icon={faHand} /> Claim
    </button>
  );

  const releaseButton = (item: LootView) => (
    <button type="button" className="btn btn-xs btn-ghost" disabled={busyId === item.id} onClick={() => release(item)}>
      <Icon icon={faArrowRotateLeft} /> Release
    </button>
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div role="tablist" className="tabs tabs-box tabs-sm">
          {(["pool", "available", "history", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={statusFilter === f}
              className={`tab ${statusFilter === f ? "tab-active" : ""}`}
              onClick={() => onStatusFilter(f)}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
        <select
          className="select select-sm w-auto"
          aria-label="Session"
          value={sessionFilter}
          onChange={(e) => onSessionFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
        >
          <option value="all">All sessions</option>
          {view.sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.date}
              {s.title ? ` — ${s.title}` : ""}
            </option>
          ))}
        </select>
        <select
          className="select select-sm w-auto"
          aria-label="Claimed by"
          value={claimedBy}
          onChange={(e) => onClaimFilter(e.target.value)}
        >
          <option value="all">Anyone</option>
          <option value="none">Unclaimed</option>
          {[...view.characters]
            .sort((a, b) => byName.compare(a.name, b.name))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <label className="input input-sm w-48">
          <Icon icon={faMagnifyingGlass} className="text-base-content/50" />
          <input
            type="search"
            placeholder="Search by name"
            aria-label="Search items by name"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onSearch("")}
          />
        </label>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!filtered} onClick={onClear}>
          <Icon icon={faXmark} /> Clear
        </button>
        <span className="text-sm text-base-content/70">
          {rows.length} {rows.length === 1 ? "item" : "items"} · <Money amount={shownTotal} campaign={campaign} />
        </span>
        {gm && (
          <span
            className={`ml-auto ${view.sessions.length ? "" : "tooltip tooltip-left"}`}
            data-tip="Create a session first"
          >
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!view.sessions.length}
              onClick={() => setEditing("new")}
            >
              <Icon icon={faPlus} /> Add loot
            </button>
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-base-content/60">
          {view.loot.length === 0 ? "No loot recorded yet." : "No items match these filters."}
        </p>
      ) : (
        <div>
          <table className="table table-sm">
            <thead>
              <tr>
                {sortHeader("name", "Item", "w-full")}
                {sortHeader("quantity", "Qty", "text-right")}
                {sortHeader("value", "Each", "hidden text-right sm:table-cell")}
                {sortHeader("marketPct", "Market", "hidden text-right sm:table-cell")}
                {sortHeader("subtotal", "Subtotal", "text-right")}
                {sortHeader("status", "Status", "hidden sm:table-cell")}
                {sortHeader("claim", "Claim", "hidden sm:table-cell")}
                {sessionFilter === "all" && sortHeader("session", "Session", "hidden md:table-cell")}
                <th className="text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const mine = mode.kind === "player" && item.characterId === mode.characterId;
                const session = sessionById.get(item.sessionId);
                const claimant = item.characterId !== null ? nameById.get(item.characterId) : undefined;
                return (
                  <tr key={item.id} className={mine ? "bg-warning/10" : ""}>
                    <td className="min-w-40">
                      <div className="font-medium">
                        {item.link ? (
                          <a href={item.link} target="_blank" rel="noopener noreferrer" className="link link-hover">
                            {item.name}
                            <Icon icon={faArrowUpRightFromSquare} className="ml-1 text-xs text-base-content/50" />
                            <span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        ) : (
                          item.name
                        )}
                        {item.unidentified && (
                          <span
                            className="tooltip tooltip-right ml-2 align-middle"
                            data-tip={
                              gm
                                ? "Players can't see its details or claim it; left out of totals and splits"
                                : "Its details and value are unknown until it's identified"
                            }
                          >
                            <span className="badge badge-sm badge-soft badge-warning gap-1 font-normal">
                              <Icon icon={faCircleQuestion} /> Unidentified
                            </span>
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-1 sm:hidden">
                        {statusPill(item, "right")}
                        {claimant && <span className="text-xs text-base-content/70">{claimant}</span>}
                      </div>
                      {item.description && (
                        <div className="max-w-md text-xs whitespace-pre-line text-base-content/60">
                          {item.description}
                        </div>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{item.quantity}</td>
                    <td className="hidden text-right sm:table-cell">
                      {item.unidentified && !gm ? (
                        <span className="text-base-content/50">?</span>
                      ) : item.value === null ? (
                        <span className="text-base-content/50">—</span>
                      ) : (
                        <Money amount={item.value} campaign={campaign} />
                      )}
                    </td>
                    <td className="hidden text-right tabular-nums sm:table-cell">{item.marketPct}%</td>
                    <td className="text-right font-medium">
                      {item.unidentified && !gm ? (
                        <span className="text-base-content/50">?</span>
                      ) : (
                        <Money
                          amount={item.subtotal}
                          campaign={campaign}
                          className={item.unidentified ? "text-base-content/50 line-through" : undefined}
                        />
                      )}
                    </td>
                    <td className="hidden sm:table-cell">
                      {statusPill(item)}
                    </td>
                    <td className="hidden whitespace-nowrap sm:table-cell">{claimant}</td>
                    {sessionFilter === "all" && (
                      <td className="hidden whitespace-nowrap text-base-content/70 md:table-cell">
                        {session?.title || session?.notes ? (
                          <span className="tooltip tooltip-left">
                            <span className="tooltip-content text-left">
                              {session.title && <span className="block font-semibold">{session.title}</span>}
                              {session.notes && <span className="block whitespace-pre-line">{session.notes}</span>}
                            </span>
                            {session.date}
                          </span>
                        ) : (
                          session?.date
                        )}
                      </td>
                    )}
                    <td className="text-right whitespace-nowrap">
                      {gm ? (
                        <>
                          {item.status === "available" && canClaim && claimButton(item)}
                          {item.status === "claimed" && releaseButton(item)}
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs btn-square"
                            aria-label={`Edit ${item.name}`}
                            onClick={() => setEditing(item)}
                          >
                            <Icon icon={faPen} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs btn-square"
                            aria-label={`Delete ${item.name}`}
                            disabled={busyId === item.id}
                            onClick={() => remove(item)}
                          >
                            <Icon icon={faTrash} />
                          </button>
                        </>
                      ) : item.status === "available" && canClaim && !item.unidentified ? (
                        claimButton(item)
                      ) : mine && item.status === "claimed" ? (
                        releaseButton(item)
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <LootForm
          view={view}
          item={editing === "new" ? undefined : editing}
          defaultSessionId={sessionFilter === "all" ? undefined : sessionFilter}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {assigning && (
        <StatusCharacterForm
          item={assigning.item}
          status={assigning.status}
          characters={assigning.status === "claimed" ? claimants : view.characters}
          onClose={() => setAssigning(null)}
          onSaved={(forName) => {
            toast(`Marked ${assigning.item.name} ${assigning.status} by ${forName}.`);
            refresh();
          }}
        />
      )}
      {claiming && (
        <ClaimForm
          item={claiming}
          campaign={campaign}
          {...(mode.kind === "player" ? { characterId: mode.characterId } : { characters: claimants })}
          onClose={() => setClaiming(null)}
          onSaved={(forName) => {
            toast(forName ? `Claimed ${claiming.name} for ${forName}.` : `Claimed ${claiming.name}.`);
            refresh();
          }}
        />
      )}
    </div>
  );
}
