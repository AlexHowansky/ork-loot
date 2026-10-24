import { useQuery } from "@tanstack/react-query";
import { api } from "../api.ts";
import { splitPreviewKey } from "../queries.ts";
import type { CampaignInfo, SplitView } from "../../shared/types.ts";
import { Modal } from "./Modal.tsx";
import { Money } from "./Money.tsx";
import { SplitTable } from "./SplitHistory.tsx";
import { FormError } from "./Field.tsx";
import { CancelButton, SubmitButton } from "./SubmitButton.tsx";
import { useSubmit } from "./useSubmit.ts";
import { errorMessage } from "../api.ts";
import { listNames } from "../../shared/names.ts";

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
    queryKey: splitPreviewKey(campaign.id),
    queryFn: () => api.get<SplitView>(`/api/campaigns/${campaign.id}/split/preview`),
    gcTime: 0,
  });
  const s = useSubmit();
  // The total can be nothing when the loot all goes to topping up petty
  // cash, so emptiness is judged by the loot alone.
  const empty =
    preview.data && (preview.data.total - preview.data.pettyCash === 0 || preview.data.totalShares === 0);
  const owing = preview.data?.shares.filter((sh) => sh.net < 0) ?? [];
  // Without debt allowed, nobody may end a split owing.
  const blocked = !campaign.allowDebt && owing.length > 0;

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
          <SubmitButton busy={s.busy} disabled={!preview.data || !!empty || blocked}>
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
              <Money
                amount={preview.data.total - preview.data.pettyCash}
                campaign={campaign}
                className="font-semibold"
              />
              {preview.data.pettyCash > 0 && (
                <>
                  , and <Money amount={preview.data.pettyCash} campaign={campaign} className="font-semibold" /> of
                  petty cash {campaign.pettyCashHold > 0 ? "above its hold " : ""}is paid out with it
                </>
              )}
              {preview.data.pettyCash < 0 && (
                <>
                  , of which <Money amount={-preview.data.pettyCash} campaign={campaign} className="font-semibold" />{" "}
                  is kept back to top petty cash up to its hold of{" "}
                  <Money amount={campaign.pettyCashHold} campaign={campaign} className="font-semibold" />
                </>
              )}
              . Available
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
                    divide evenly across the shares and will be added to petty cash.
                  </p>
                )}
                {owing.length > 0 &&
                  (blocked ? (
                    <div role="alert" className="alert alert-warning alert-soft mt-2 py-2">
                      <span>
                        {listNames(owing.map((sh) => sh.characterName))} would end the split owing, because their
                        claims are worth more than their share. Release some claims, or allow debt in the
                        campaign's settings.
                      </span>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-base-content/70">
                      A negative payout is carried forward as debt and taken off that character's later payouts.
                    </p>
                  ))}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
