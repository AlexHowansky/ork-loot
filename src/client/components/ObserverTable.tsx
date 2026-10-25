import { useState } from "react";
import { api, errorMessage } from "../api.ts";
import { useRefresh } from "../queries.ts";
import type { CampaignView, ObserverView } from "../../shared/types.ts";
import { ObserverForm } from "./SimpleForms.tsx";
import { useConfirm } from "./Confirm.tsx";
import { useToast } from "./Toast.tsx";
import { Icon, faArrowsRotate, faPen, faPlus, faTrash } from "./Icon.tsx";
import { JoinCodeStatus } from "./JoinCode.tsx";

/** The GM's list of observers, who follow the campaign read-only. */
export function ObserverTable({ view }: { view: CampaignView }) {
  const { campaign } = view;
  const observers = view.observers ?? [];
  const [editing, setEditing] = useState<ObserverView | "new" | null>(null);
  const refresh = useRefresh();
  const ask = useConfirm();
  const toast = useToast();

  async function attempt(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      toast(done);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      refresh();
    }
  }

  async function newCode(o: ObserverView) {
    const ok = await ask({
      title: `New join code for ${o.name}?`,
      message: (
        <p>
          Any unused code for {o.name} stops working.
          {o.hasPlayer && ` Whoever is observing as ${o.name} loses access straight away, until someone redeems the new code.`}
        </p>
      ),
      confirmLabel: "Create new code",
    });
    if (ok) await attempt(() => api.post(`/api/observers/${o.id}/code`), `New code ready for ${o.name}.`);
  }

  async function remove(o: ObserverView) {
    const ok = await ask({
      title: `Delete ${o.name}?`,
      message: <p>{o.hasPlayer ? `Whoever is observing as ${o.name} loses access straight away.` : "Their join code stops working."}</p>,
      confirmLabel: "Delete observer",
      danger: true,
    });
    if (ok) await attempt(() => api.del(`/api/observers/${o.id}`), `Deleted ${o.name}.`);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-base-content/70">
          Observers see the campaign as players do, but have no share and can't claim loot.
        </p>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing("new")}>
          <Icon icon={faPlus} /> Add observer
        </button>
      </div>
      {observers.length === 0 ? (
        <p className="py-6 text-center text-base-content/60">
          No observers yet. Add one for anyone who should follow along; each gets a join code.
        </p>
      ) : (
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Observer</th>
              <th>Player</th>
              <th className="text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {observers.map((o) => (
              <tr key={o.id}>
                <td className="font-medium">{o.name}</td>
                <td className="whitespace-nowrap">
                  <JoinCodeStatus
                    name={o.name}
                    joinCode={o.joinCode}
                    joinUrl={view.joinUrl}
                    hasPlayer={o.hasPlayer}
                    online={o.online}
                    onlineTitle={`${o.name} has the campaign open now.`}
                  />
                </td>
                <td className="text-right whitespace-nowrap">
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => newCode(o)}>
                    <Icon icon={faArrowsRotate} /> New code
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    aria-label={`Edit ${o.name}`}
                    onClick={() => setEditing(o)}
                  >
                    <Icon icon={faPen} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    aria-label={`Delete ${o.name}`}
                    onClick={() => remove(o)}
                  >
                    <Icon icon={faTrash} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <ObserverForm
          campaignId={campaign.id}
          observer={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
