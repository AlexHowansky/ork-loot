import { useState } from "react";
import { api, errorMessage } from "../api.ts";
import { useRefresh } from "../queries.ts";
import { formatMoney } from "../../shared/money.ts";
import type { CampaignView, PettyCashEntryView } from "../../shared/types.ts";
import { Money } from "./Money.tsx";
import { PettyCashForm } from "./SimpleForms.tsx";
import { useConfirm } from "./Confirm.tsx";
import { useToast } from "./Toast.tsx";
import { Icon, faPen, faPlus, faScaleBalanced, faTrash } from "./Icon.tsx";
import type { Mode } from "./Board.tsx";

/** The petty cash ledger: the GM's adjustments and each split's change. */
export function PettyCashLedger({ view, mode }: { view: CampaignView; mode: Mode }) {
  const [editing, setEditing] = useState<PettyCashEntryView | "new" | null>(null);
  const refresh = useRefresh();
  const ask = useConfirm();
  const toast = useToast();
  const gm = mode.kind === "gm";
  const { campaign } = view;
  const money = (n: number) => formatMoney(n, campaign.currencyDecimals, campaign.currencyLabel);

  // The ledger is newest first; balances build up from the oldest entry.
  const balances = new Map<number, number>();
  let running = 0;
  for (const e of [...view.pettyCash].reverse()) {
    running += e.amount;
    balances.set(e.id, running);
  }

  /** What a split's entry is made of, e.g. a top-up and its leftover. */
  function splitDetail(splitId: number): string | null {
    const split = view.splits.find((s) => s.id === splitId);
    if (!split) return null;
    const parts: string[] = [];
    if (split.pettyCash < 0) parts.push(`${money(-split.pettyCash)} kept back to reach the hold`);
    if (split.pettyCash > 0) parts.push(`${money(split.pettyCash)} above the hold paid out`);
    if (split.leftover > 0) parts.push(`${money(split.leftover)} that didn't divide evenly`);
    return parts.join(", ");
  }

  async function remove(e: PettyCashEntryView) {
    const ok = await ask({
      title: "Delete this entry?",
      message: (
        <p>
          <strong>{e.description}</strong> is removed from the ledger, and petty cash goes{" "}
          {e.amount > 0 ? "down" : "up"} by {money(Math.abs(e.amount))}.
        </p>
      ),
      confirmLabel: "Delete entry",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/petty-cash/${e.id}`);
      toast("Entry deleted.");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      refresh();
    }
  }

  return (
    <div>
      {gm && (
        <div className="mb-2 flex justify-end">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing("new")}>
            <Icon icon={faPlus} /> Add entry
          </button>
        </div>
      )}
      {view.pettyCash.length === 0 ? (
        <p className="py-6 text-center text-base-content/60">
          No petty cash entries yet.{gm && " Add one to record money paid in or out."}
        </p>
      ) : (
        <div>
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Balance</th>
                {gm && (
                  <th className="text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {view.pettyCash.map((e) => {
                const detail = e.splitId === null ? null : splitDetail(e.splitId);
                return (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap font-medium">{e.date}</td>
                    <td>
                      {e.splitId !== null && <Icon icon={faScaleBalanced} className="mr-1 text-base-content/60" />}
                      {e.description}
                      {detail && <div className="text-xs text-base-content/60">{detail}</div>}
                    </td>
                    <td className="text-right">
                      <Money amount={e.amount} campaign={campaign} />
                    </td>
                    <td className="text-right">
                      <Money amount={balances.get(e.id) ?? 0} campaign={campaign} />
                    </td>
                    {gm && (
                      <td className="text-right whitespace-nowrap">
                        {/* A split's entry goes only when the split is undone. */}
                        {e.splitId === null && (
                          <>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs btn-square"
                              aria-label={`Edit entry ${e.description}`}
                              onClick={() => setEditing(e)}
                            >
                              <Icon icon={faPen} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs btn-square"
                              aria-label={`Delete entry ${e.description}`}
                              onClick={() => remove(e)}
                            >
                              <Icon icon={faTrash} />
                            </button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <PettyCashForm
          campaign={campaign}
          entry={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
