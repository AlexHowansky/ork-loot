import { useState } from "react";
import { api, errorMessage } from "../api.ts";
import { useRefresh } from "../queries.ts";
import type { CampaignView, LootView } from "../../shared/types.ts";
import type { LootStatus } from "../../shared/status.ts";
import { formatMoney } from "../../shared/money.ts";
import { Money } from "./Money.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import { LootForm } from "./LootForm.tsx";
import { ClaimForm } from "./SimpleForms.tsx";
import { useConfirm } from "./Confirm.tsx";
import { useToast } from "./Toast.tsx";
import { Icon, faArrowRotateLeft, faArrowUpRightFromSquare, faHandHolding, faPen, faPlus, faTrash } from "./Icon.tsx";
import type { Mode } from "./Board.tsx";

export type StatusFilter = "pool" | "history" | "all";

const FILTER: Record<StatusFilter, (s: LootStatus) => boolean> = {
  pool: (s) => s === "active" || s === "party" || s === "claimed",
  history: (s) => s === "sold" || s === "bought" || s === "left",
  all: () => true,
};

export function LootTable({
  view,
  mode,
  sessionFilter,
  onSessionFilter,
  statusFilter,
  onStatusFilter,
}: {
  view: CampaignView;
  mode: Mode;
  sessionFilter: number | "all";
  onSessionFilter: (v: number | "all") => void;
  statusFilter: StatusFilter;
  onStatusFilter: (v: StatusFilter) => void;
}) {
  const { campaign } = view;
  const [editing, setEditing] = useState<LootView | "new" | null>(null);
  const [claiming, setClaiming] = useState<LootView | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const refresh = useRefresh();
  const ask = useConfirm();
  const toast = useToast();
  const gm = mode.kind === "gm";

  const sessionById = new Map(view.sessions.map((s) => [s.id, s]));
  const nameById = new Map(view.characters.map((c) => [c.id, c.name]));
  const rows = view.loot.filter(
    (l) => FILTER[statusFilter](l.status) && (sessionFilter === "all" || l.sessionId === sessionFilter),
  );
  const shownTotal = rows.reduce((n, l) => n + l.subtotal, 0);

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
          <strong>{item.name}</strong> will be removed for good. To record that it was sold or left behind,
          change its status instead.
        </p>
      ),
      confirmLabel: "Delete item",
      danger: true,
    });
    if (ok) await act(item, () => api.del(`/api/loot/${item.id}`), `Deleted ${item.name}.`);
  }

  function claim(item: LootView) {
    if (mode.kind !== "player") return;
    if (item.quantity > 1) {
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
    if (mode.kind !== "player") return;
    act(
      item,
      () => api.post(`/api/play/${mode.characterId}/release`, { lootId: item.id }),
      `Released ${item.name} back to the pool.`,
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div role="tablist" className="tabs tabs-box tabs-sm">
          {(["pool", "history", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={statusFilter === f}
              className={`tab ${statusFilter === f ? "tab-active" : ""}`}
              onClick={() => onStatusFilter(f)}
            >
              {f === "pool" ? "In pool" : f === "history" ? "Gone" : "All"}
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
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Item</th>
                {sessionFilter === "all" && <th className="hidden md:table-cell">Session</th>}
                <th className="text-right">Qty</th>
                <th className="hidden text-right sm:table-cell">Value each</th>
                <th className="hidden text-right sm:table-cell">Market</th>
                <th className="text-right">Subtotal</th>
                <th className="hidden sm:table-cell">Status</th>
                <th className="text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const mine = mode.kind === "player" && item.characterId === mode.characterId;
                const session = sessionById.get(item.sessionId);
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
                      </div>
                      <div className="sm:hidden">
                        <StatusBadge
                          status={item.status}
                          who={item.characterId !== null ? nameById.get(item.characterId) : null}
                        />
                      </div>
                      {item.description && (
                        <div className="max-w-md text-xs whitespace-pre-line text-base-content/60">
                          {item.description}
                        </div>
                      )}
                    </td>
                    {sessionFilter === "all" && (
                      <td className="hidden whitespace-nowrap text-base-content/70 md:table-cell">{session?.date}</td>
                    )}
                    <td className="text-right tabular-nums">{item.quantity}</td>
                    <td className="hidden text-right sm:table-cell">
                      {item.value === null ? (
                        <span className="text-base-content/50">—</span>
                      ) : (
                        <span className="tabular-nums whitespace-nowrap">
                          {formatMoney(item.value, campaign.currencyDecimals, "")}
                        </span>
                      )}
                    </td>
                    <td className="hidden text-right tabular-nums sm:table-cell">{item.marketPct}%</td>
                    <td className="text-right font-medium">
                      <Money amount={item.subtotal} campaign={campaign} />
                    </td>
                    <td className="hidden sm:table-cell">
                      <StatusBadge
                        status={item.status}
                        who={item.characterId !== null ? nameById.get(item.characterId) : null}
                      />
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {gm ? (
                        <>
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
                      ) : item.status === "active" ? (
                        <button
                          type="button"
                          className="btn btn-xs"
                          disabled={busyId === item.id}
                          onClick={() => claim(item)}
                        >
                          <Icon icon={faHandHolding} /> Claim
                        </button>
                      ) : mine && item.status === "claimed" ? (
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          disabled={busyId === item.id}
                          onClick={() => release(item)}
                        >
                          <Icon icon={faArrowRotateLeft} /> Release
                        </button>
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
      {claiming && mode.kind === "player" && (
        <ClaimForm
          item={claiming}
          campaign={campaign}
          characterId={mode.characterId}
          onClose={() => setClaiming(null)}
          onSaved={() => {
            toast(`Claimed ${claiming.name}.`);
            refresh();
          }}
        />
      )}
    </div>
  );
}
