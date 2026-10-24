import { useQuery } from "@tanstack/react-query";
import { api } from "../api.ts";
import type { CampaignInfo, SplitView } from "../../shared/types.ts";
import { Modal } from "./Modal.tsx";
import { Money } from "./Money.tsx";
import { SplitTable } from "./SplitHistory.tsx";
import { FormError } from "./Field.tsx";
import { CancelButton, SubmitButton } from "./SubmitButton.tsx";
import { useSubmit } from "./useSubmit.ts";
import { errorMessage } from "../api.ts";

/** Previews a loot split and runs it on confirmation. */
export function SplitModal({
  campaign,
  onClose,
  onDone,
}: {
  campaign: CampaignInfo;
  onClose: () => void;
  onDone: (split: SplitView) => void;
}) {
  const preview = useQuery({
    queryKey: ["split-preview", campaign.id],
    queryFn: () => api.get<SplitView>(`/api/campaigns/${campaign.id}/split/preview`),
    gcTime: 0,
  });
  const s = useSubmit();
  const empty = preview.data && (preview.data.total === 0 || preview.data.totalShares === 0);

  const submit = () =>
    s.run(async () => {
      const split = await api.post<SplitView>(`/api/campaigns/${campaign.id}/split`);
      onDone(split);
      onClose();
    });

  return (
    <Modal
      title="Run a loot split"
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <CancelButton onClick={onClose} />
          <SubmitButton busy={s.busy} disabled={!preview.data || !!empty}>
            Run split
          </SubmitButton>
        </>
      }
    >
      <div className="max-w-2xl">
        <FormError message={s.message} />
        {preview.isPending && <span className="loading loading-spinner" aria-label="Loading" />}
        {preview.error && <FormError message={errorMessage(preview.error)} />}
        {preview.data && (
          <>
            <p className="mb-2">
              Selling the pool brings in{" "}
              <Money amount={preview.data.total} campaign={campaign} className="font-semibold" />. Available
              items become <em>sold</em>, claimed items become <em>bought</em>, and the party fund is kept.
            </p>
            {empty ? (
              <p className="text-base-content/70">
                {preview.data.totalShares === 0
                  ? "Give at least one character a share before running a split."
                  : "There's no available or claimed loot to split."}
              </p>
            ) : (
              <>
                <SplitTable split={preview.data} campaign={campaign} />
                {preview.data.leftover > 0 && (
                  <p className="mt-2 text-sm text-base-content/70">
                    <Money amount={preview.data.leftover} campaign={campaign} className="font-semibold" /> doesn't
                    divide evenly across the shares and will go to petty cash.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
