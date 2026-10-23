import { useState } from "react";
import { api } from "../api.ts";
import { MAX_DECIMALS } from "../../shared/money.ts";
import type { CampaignInfo } from "../../shared/types.ts";
import { Field, FormError, withError } from "./Field.tsx";
import { Modal } from "./Modal.tsx";
import { CancelButton, SubmitButton } from "./SubmitButton.tsx";
import { useSubmit } from "./useSubmit.ts";

const today = () => new Date().toISOString().slice(0, 10);

/** Creates a campaign, or edits one when `campaign` is given. */
export function CampaignForm({
  campaign,
  decimalsLocked = false,
  onClose,
  onSaved,
}: {
  campaign?: CampaignInfo;
  /** Decimal places can't change once loot exists. */
  decimalsLocked?: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(campaign?.name ?? "");
  const [startDate, setStartDate] = useState(campaign?.startDate ?? today());
  const [currencyLabel, setLabel] = useState(campaign?.currencyLabel ?? "gp");
  const [currencyDecimals, setDecimals] = useState(campaign?.currencyDecimals ?? 2);
  const [baseReferenceUrl, setReferenceUrl] = useState(campaign?.baseReferenceUrl ?? "");
  const [image, setImage] = useState<File | null>(null);
  const s = useSubmit();

  const submit = () =>
    s.run(async () => {
      const body = { name, startDate, currencyLabel, currencyDecimals, baseReferenceUrl };
      const saved = campaign
        ? await api.patch<CampaignInfo>(`/api/campaigns/${campaign.id}`, body)
        : await api.post<CampaignInfo>("/api/campaigns", body);
      if (image) {
        const form = new FormData();
        form.append("image", image);
        await api.put(`/api/campaigns/${saved.id}/image`, form);
      }
      onSaved(saved.id);
    });

  return (
    <Modal
      title={campaign ? "Edit campaign" : "New campaign"}
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <CancelButton onClick={onClose} />
          <SubmitButton busy={s.busy}>{campaign ? "Save campaign" : "Create campaign"}</SubmitButton>
        </>
      }
    >
      <div className="w-80 max-w-full">
        <FormError message={s.hasFieldErrors ? null : s.message} />
        <Field label="Name" error={s.fields.name}>
          <input
            className={withError("input w-full", s.fields.name)}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Start date" error={s.fields.startDate}>
          <input
            type="date"
            className={withError("input w-full", s.fields.startDate)}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <div className="flex gap-3">
          <Field label="Currency" error={s.fields.currencyLabel}>
            <input
              className={withError("input w-24", s.fields.currencyLabel)}
              placeholder="gp"
              value={currencyLabel}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field
            label="Decimal places"
            error={s.fields.currencyDecimals}
            hint={decimalsLocked ? "Locked once loot is recorded." : undefined}
          >
            <select
              className={withError("select w-32", s.fields.currencyDecimals)}
              disabled={decimalsLocked}
              value={currencyDecimals}
              onChange={(e) => setDecimals(Number(e.target.value))}
            >
              {Array.from({ length: MAX_DECIMALS + 1 }, (_, i) => (
                <option key={i} value={i}>
                  {i === 0 ? "None" : (0).toFixed(i)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Base reference URL"
          error={s.fields.baseReferenceUrl}
          hint="Optional. Item links will point here."
        >
          <input
            type="url"
            className={withError("input w-full", s.fields.baseReferenceUrl)}
            placeholder="https://"
            value={baseReferenceUrl}
            onChange={(e) => setReferenceUrl(e.target.value)}
          />
        </Field>
        <Field label={campaign?.backgroundImage ? "Replace background image" : "Background image"} hint="Optional. PNG, JPEG or WebP, up to 5 MB.">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="file-input w-full"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
          />
        </Field>
      </div>
    </Modal>
  );
}
