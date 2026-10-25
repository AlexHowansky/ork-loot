import { useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../api.ts";
import { keys, useWatch } from "../queries.ts";
import { useLiveUpdates } from "../live.ts";
import { CampaignBoard } from "../components/Board.tsx";
import { LoadError, Loading } from "../components/Layout.tsx";
import { useConfirm } from "../components/Confirm.tsx";
import { useToast } from "../components/Toast.tsx";
import { Icon, faArrowRightFromBracket } from "../components/Icon.tsx";
import type { WatchView } from "../../shared/types.ts";

/** An observer's read-only view of a campaign. */
export function WatchPage() {
  const id = useParams().id ?? "";
  const { data: view, error, isPending } = useWatch(id);
  const ask = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useLiveUpdates(`/api/watch/${id}/events`, [keys.watch(id)], () => {
    const name = qc.getQueryData<WatchView>(keys.watch(id))?.campaign.name ?? "the campaign";
    qc.removeQueries({ queryKey: keys.watch(id) });
    void qc.invalidateQueries({ queryKey: keys.me });
    navigate("/");
    toast(
      `Your GM withdrew this browser's access to ${name}. ` +
        "Ask your GM for a new join code to come back.",
      "info",
    );
  });

  if (isPending) return <Loading />;
  if (error) return <LoadError error={error} />;

  async function leave() {
    const name = view!.campaign.name;
    const ok = await ask({
      title: `Stop observing ${name} here?`,
      message: <p>This browser forgets {name}. You'll need a new code from your GM to come back.</p>,
      confirmLabel: "Stop observing",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/watch/${id}`);
      qc.removeQueries({ queryKey: keys.watch(id) });
      await qc.invalidateQueries({ queryKey: keys.me });
      navigate("/");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <CampaignBoard
      view={view}
      mode={{ kind: "observer", name: view.observer.name }}
      actions={
        <button type="button" className="btn btn-sm" onClick={leave}>
          <Icon icon={faArrowRightFromBracket} /> Stop observing
        </button>
      }
    />
  );
}
