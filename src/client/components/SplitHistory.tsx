import { useState } from "react";
import { api, errorMessage } from "../api.ts";
import { useRefresh } from "../queries.ts";
import type { CampaignInfo, CampaignView, SplitView } from "../../shared/types.ts";
import { Money } from "./Money.tsx";
import { useConfirm } from "./Confirm.tsx";
import { useToast } from "./Toast.tsx";
import { Icon, faArrowRotateLeft } from "./Icon.tsx";
import type { Mode } from "./Board.tsx";

export function SplitTable({ split, campaign }: { split: SplitView; campaign: CampaignInfo }) {
  const owed = split.shares.some((s) => s.debtIn > 0);
  return (
    <div>
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Character</th>
            <th className="text-right">Shares</th>
            <th className="text-right">Share of sale</th>
            <th className="text-right">Claimed</th>
            {owed && <th className="text-right">Debt in</th>}
            <th className="text-right">Payout</th>
          </tr>
        </thead>
        <tbody>
          {split.shares.map((s) => (
            <tr key={`${s.characterId}-${s.characterName}`}>
              <td className="font-medium">{s.characterName}</td>
              <td className="text-right tabular-nums">{s.shares}</td>
              <td className="text-right">
                <Money amount={s.gross} campaign={campaign} />
              </td>
              <td className="text-right">
                <Money amount={s.claimed} campaign={campaign} />
              </td>
              {owed && (
                <td className="text-right">
                  <Money amount={s.debtIn} campaign={campaign} />
                </td>
              )}
              <td className="text-right font-semibold">
                <Money amount={s.net} campaign={campaign} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function SplitHistory({ view, mode }: { view: CampaignView; mode: Mode }) {
  const [undoing, setUndoing] = useState(false);
  const ask = useConfirm();
  const toast = useToast();
  const refresh = useRefresh();

  async function undo(split: SplitView) {
    // Reversing only the split's own change keeps later ledger entries.
    const pettyCashAfter = view.campaign.pettyCash - (split.leftover - split.pettyCash);
    const ok = await ask({
      title: "Undo this split?",
      message: (
        <p className="max-w-md">
          Bought items go back to their claimants and sold items back to the pool, petty cash goes to{" "}
          <Money amount={pettyCashAfter} campaign={view.campaign} className="font-semibold" /> as the split's
          ledger entry is removed, each character's debt returns to what it was before, and the split is removed
          from the history.
        </p>
      ),
      confirmLabel: "Undo split",
      danger: true,
    });
    if (!ok) return;
    setUndoing(true);
    try {
      await api.del(`/api/campaigns/${view.campaign.id}/splits/${split.id}`);
      toast("Split undone.");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setUndoing(false);
      refresh();
    }
  }

  if (view.splits.length === 0) {
    return <p className="py-6 text-center text-base-content/60">No loot splits yet.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {view.splits.map((split, i) => (
        <details key={split.id} className="collapse collapse-arrow border border-base-300 bg-base-100" open={i === 0}>
          <summary className="collapse-title flex flex-wrap items-center gap-x-4 font-medium">
            <span>{when(split.createdAt)}</span>
            <span className="text-base-content/70">
              Divided <Money amount={split.total} campaign={view.campaign} />
              {split.pettyCash > 0 && (
                <>
                  {" "}
                  (with <Money amount={split.pettyCash} campaign={view.campaign} /> petty cash)
                </>
              )}
            </span>
            {split.pettyCash < 0 && (
              <span className="text-base-content/70">
                <Money amount={-split.pettyCash} campaign={view.campaign} /> kept back for petty cash
              </span>
            )}
            {split.leftover > 0 && (
              <span className="text-base-content/70">
                <Money amount={split.leftover} campaign={view.campaign} /> left over to petty cash
              </span>
            )}
          </summary>
          <div className="collapse-content">
            <SplitTable split={split} campaign={view.campaign} />
            {/* Only the latest split can be undone; later ones build on it. */}
            {mode.kind === "gm" && i === 0 && (
              <div className="mt-2 flex justify-end">
                <button type="button" className="btn btn-sm" disabled={undoing} onClick={() => undo(split)}>
                  <Icon icon={faArrowRotateLeft} /> Undo split
                </button>
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
