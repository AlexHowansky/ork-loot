import { useState } from "react";
import { api, errorMessage } from "../api.ts";
import { useRefresh } from "../queries.ts";
import type { CampaignView, SessionView } from "../../shared/types.ts";
import { SessionForm } from "./SimpleForms.tsx";
import { useConfirm } from "./Confirm.tsx";
import { useToast } from "./Toast.tsx";
import { Icon, faPen, faPlus, faTrash } from "./Icon.tsx";
import type { Mode } from "./Board.tsx";

export function SessionTable({
  view,
  mode,
  onShowLoot,
}: {
  view: CampaignView;
  mode: Mode;
  onShowLoot: (sessionId: number) => void;
}) {
  const [editing, setEditing] = useState<SessionView | "new" | null>(null);
  const refresh = useRefresh();
  const ask = useConfirm();
  const toast = useToast();
  const gm = mode.kind === "gm";

  async function remove(s: SessionView) {
    const ok = await ask({
      title: `Delete the ${s.date} session?`,
      message: (
        <p>
          {s.itemCount > 0
            ? `Its ${s.itemCount} loot ${s.itemCount === 1 ? "item is" : "items are"} deleted too. `
            : ""}
          Past split payouts stay in the history.
        </p>
      ),
      confirmLabel: "Delete session",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/sessions/${s.id}`);
      toast("Session deleted.");
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
            <Icon icon={faPlus} /> New session
          </button>
        </div>
      )}
      {view.sessions.length === 0 ? (
        <p className="py-6 text-center text-base-content/60">
          No sessions yet.{gm && " Create one to start adding loot."}
        </p>
      ) : (
        <div>
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Date</th>
                <th>Title</th>
                <th>Notes</th>
                <th className="text-right">Items</th>
                <th className="text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {view.sessions.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap font-medium">{s.date}</td>
                  <td>{s.title ?? <span className="text-base-content/50">—</span>}</td>
                  <td className="max-w-md text-sm whitespace-pre-line text-base-content/70">{s.notes}</td>
                  <td className="text-right tabular-nums">{s.itemCount}</td>
                  <td className="text-right whitespace-nowrap">
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => onShowLoot(s.id)}>
                      Show loot
                    </button>
                    {gm && (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-square"
                          aria-label={`Edit session ${s.date}`}
                          onClick={() => setEditing(s)}
                        >
                          <Icon icon={faPen} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-square"
                          aria-label={`Delete session ${s.date}`}
                          onClick={() => remove(s)}
                        >
                          <Icon icon={faTrash} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <SessionForm
          campaignId={view.campaign.id}
          session={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
