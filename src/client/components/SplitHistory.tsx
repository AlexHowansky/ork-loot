import type { CampaignInfo, CampaignView, SplitView } from "../../shared/types.ts";
import { Money } from "./Money.tsx";

export function SplitTable({ split, campaign }: { split: SplitView; campaign: CampaignInfo }) {
  return (
    <div>
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Character</th>
            <th className="text-right">Shares</th>
            <th className="text-right">Share of sale</th>
            <th className="text-right">Claimed</th>
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

export function SplitHistory({ view }: { view: CampaignView }) {
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
              Sold for <Money amount={split.total} campaign={view.campaign} />
            </span>
            {split.leftover > 0 && (
              <span className="text-base-content/70">
                <Money amount={split.leftover} campaign={view.campaign} /> to petty cash
              </span>
            )}
          </summary>
          <div className="collapse-content">
            <SplitTable split={split} campaign={view.campaign} />
          </div>
        </details>
      ))}
    </div>
  );
}
