import { useState } from "react";
import { api, errorMessage } from "../api.ts";
import { useRefresh } from "../queries.ts";
import type { CampaignView, CharacterView } from "../../shared/types.ts";
import { Money } from "./Money.tsx";
import { CharacterForm } from "./SimpleForms.tsx";
import { useConfirm } from "./Confirm.tsx";
import { useToast } from "./Toast.tsx";
import { Icon, faArrowsRotate, faCircleCheck, faCopy, faPen, faPlus, faTrash } from "./Icon.tsx";
import type { Mode } from "./Board.tsx";

const pretty = (code: string) => `${code.slice(0, 5)}-${code.slice(5)}`;

export function CharacterTable({ view, mode }: { view: CampaignView; mode: Mode }) {
  const { campaign } = view;
  const [editing, setEditing] = useState<CharacterView | "new" | null>(null);
  const refresh = useRefresh();
  const ask = useConfirm();
  const toast = useToast();
  const gm = mode.kind === "gm";

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

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(pretty(code));
      toast("Code copied.");
    } catch {
      toast("Couldn't copy automatically. Select the code and copy it instead.", "error");
    }
  }

  async function newCode(c: CharacterView) {
    const ok = await ask({
      title: `New join code for ${c.name}?`,
      message: (
        <p>
          Any unused code for {c.name} stops working.
          {c.hasPlayer && ` Its current player loses access to ${c.name} straight away, until someone redeems the new code.`}
        </p>
      ),
      confirmLabel: "Create new code",
    });
    if (ok) await attempt(() => api.post(`/api/characters/${c.id}/code`), `New code ready for ${c.name}.`);
  }

  async function remove(c: CharacterView) {
    const ok = await ask({
      title: `Delete ${c.name}?`,
      message: <p>Anything {c.name} has claimed goes back into the pool.</p>,
      confirmLabel: "Delete character",
      danger: true,
    });
    if (ok) await attempt(() => api.del(`/api/characters/${c.id}`), `Deleted ${c.name}.`);
  }

  return (
    <div>
      {gm && (
        <div className="mb-2 flex justify-end">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing("new")}>
            <Icon icon={faPlus} /> Add character
          </button>
        </div>
      )}
      {view.characters.length === 0 ? (
        <p className="py-6 text-center text-base-content/60">
          No characters yet.{gm && " Add one for each player; each gets a join code."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Character</th>
                <th className="text-right">Shares</th>
                <th className="text-right">Share of pool</th>
                <th className="text-right">Claimed</th>
                <th className="text-right">Payout now</th>
                {gm && <th>Player</th>}
                {gm && (
                  <th className="text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {view.characters.map((c) => {
                const me = mode.kind === "player" && c.id === mode.characterId;
                return (
                  <tr key={c.id} className={me ? "bg-primary/10" : ""}>
                    <td className="font-medium">
                      {c.name}
                      {me && <span className="badge badge-sm badge-primary ml-2">You</span>}
                    </td>
                    <td className="text-right tabular-nums">{c.shares}</td>
                    <td className="text-right">
                      <Money amount={c.gross} campaign={campaign} />
                    </td>
                    <td className="text-right">
                      <Money amount={c.claimed} campaign={campaign} />
                    </td>
                    <td className="text-right font-semibold">
                      <Money amount={c.net} campaign={campaign} />
                    </td>
                    {gm && (
                      <td className="whitespace-nowrap">
                        {c.joinCode ? (
                          <span className="inline-flex items-center gap-1">
                            <code className="font-mono tracking-wider select-all">{pretty(c.joinCode)}</code>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs btn-square"
                              aria-label={`Copy ${c.name}'s join code`}
                              onClick={() => copy(c.joinCode!)}
                            >
                              <Icon icon={faCopy} />
                            </button>
                          </span>
                        ) : c.hasPlayer ? (
                          <span className="badge badge-sm badge-success badge-soft">
                            <Icon icon={faCircleCheck} /> Joined
                          </span>
                        ) : (
                          <span className="text-base-content/60 text-sm">No code</span>
                        )}
                      </td>
                    )}
                    {gm && (
                      <td className="text-right whitespace-nowrap">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => newCode(c)}
                        >
                          <Icon icon={faArrowsRotate} /> New code
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-square"
                          aria-label={`Edit ${c.name}`}
                          onClick={() => setEditing(c)}
                        >
                          <Icon icon={faPen} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-square"
                          aria-label={`Delete ${c.name}`}
                          onClick={() => remove(c)}
                        >
                          <Icon icon={faTrash} />
                        </button>
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
        <CharacterForm
          campaignId={campaign.id}
          character={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
