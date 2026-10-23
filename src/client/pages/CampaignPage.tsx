import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../api.ts";
import { keys, useCampaign, useRefresh } from "../queries.ts";
import { CampaignBoard } from "../components/Board.tsx";
import { CampaignForm } from "../components/CampaignForm.tsx";
import { Menu } from "../components/Menu.tsx";
import { SplitModal } from "../components/SplitModal.tsx";
import { LoadError, Loading } from "../components/Layout.tsx";
import { useConfirm } from "../components/Confirm.tsx";
import { useToast } from "../components/Toast.tsx";
import { formatMoney } from "../../shared/money.ts";
import { Icon, faChevronDown, faPen, faScaleBalanced, faTrash, faImage } from "../components/Icon.tsx";

export function CampaignPage() {
  const id = useParams().id ?? "";
  const { data: view, error, isPending } = useCampaign(id);
  const [editing, setEditing] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const refresh = useRefresh();
  const ask = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();

  if (isPending) return <Loading />;
  if (error) return <LoadError error={error} />;
  const { campaign } = view;

  async function removeImage() {
    const ok = await ask({
      title: "Remove the background image?",
      message: <p>The campaign keeps everything else.</p>,
      confirmLabel: "Remove image",
    });
    if (!ok) return;
    try {
      await api.del(`/api/campaigns/${campaign.id}/image`);
      toast("Image removed.");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
    refresh();
  }

  async function removeCampaign() {
    const ok = await ask({
      title: `Delete ${campaign.name}?`,
      message: (
        <p>
          Its characters, sessions, loot and split history are deleted for good. Players lose access.
        </p>
      ),
      confirmLabel: "Delete campaign",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/campaigns/${campaign.id}`);
      qc.removeQueries({ queryKey: keys.campaign(campaign.id) });
      await qc.invalidateQueries({ queryKey: keys.campaigns });
      toast(`Deleted ${campaign.name}.`);
      navigate("/");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <>
      <CampaignBoard
        view={view}
        mode={{ kind: "gm" }}
        actions={
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setSplitting(true)}>
              <Icon icon={faScaleBalanced} /> Loot split
            </button>
            <Menu
              label={
                <>
                  Campaign <Icon icon={faChevronDown} />
                </>
              }
            >
              <li>
                <button type="button" onClick={() => setEditing(true)}>
                  <Icon icon={faPen} /> Edit campaign
                </button>
              </li>
              {campaign.backgroundImage && (
                <li>
                  <button type="button" onClick={removeImage}>
                    <Icon icon={faImage} /> Remove image
                  </button>
                </li>
              )}
              <li>
                <button type="button" className="text-error" onClick={removeCampaign}>
                  <Icon icon={faTrash} /> Delete campaign
                </button>
              </li>
            </Menu>
          </>
        }
      />
      {editing && (
        <CampaignForm
          campaign={campaign}
          decimalsLocked={view.loot.length > 0}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
        />
      )}
      {splitting && (
        <SplitModal
          campaign={campaign}
          onClose={() => setSplitting(false)}
          onDone={(split) => {
            const money = (n: number) => formatMoney(n, campaign.currencyDecimals, campaign.currencyLabel);
            const petty = split.leftover > 0 ? `, ${money(split.leftover)} to petty cash` : "";
            toast(`Split done: ${money(split.total - split.leftover)} shared out${petty}.`);
            refresh();
          }}
        />
      )}
    </>
  );
}
