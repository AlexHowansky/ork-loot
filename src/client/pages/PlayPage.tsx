import { useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../api.ts";
import { keys, usePlay } from "../queries.ts";
import { useLiveUpdates } from "../live.ts";
import { CampaignBoard } from "../components/Board.tsx";
import { LoadError, Loading } from "../components/Layout.tsx";
import { useConfirm } from "../components/Confirm.tsx";
import { useToast } from "../components/Toast.tsx";
import { Icon, faArrowRightFromBracket } from "../components/Icon.tsx";

export function PlayPage() {
  const id = useParams().id ?? "";
  const { data: view, error, isPending } = usePlay(id);
  const ask = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useLiveUpdates(`/api/play/${id}/events`, [keys.play(id)]);

  if (isPending) return <Loading />;
  if (error) return <LoadError error={error} />;

  async function leave() {
    const ok = await ask({
      title: `Stop playing ${view!.me.name} here?`,
      message: <p>This browser forgets {view!.me.name}. You'll need a new code from your GM to come back.</p>,
      confirmLabel: "Forget character",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/play/${id}`);
      qc.removeQueries({ queryKey: keys.play(id) });
      await qc.invalidateQueries({ queryKey: keys.me });
      navigate("/");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <CampaignBoard
      view={view}
      mode={{ kind: "player", characterId: view.me.id }}
      actions={
        <button type="button" className="btn btn-sm" onClick={leave}>
          <Icon icon={faArrowRightFromBracket} /> Forget character
        </button>
      }
    />
  );
}
