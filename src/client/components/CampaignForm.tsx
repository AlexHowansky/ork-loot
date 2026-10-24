import { useId, useState } from "react";
import { api } from "../api.ts";
import { GAME_SYSTEMS, matchGameSystem } from "../../shared/game-systems.ts";
import { MAX_DECIMALS, parseAmount } from "../../shared/money.ts";
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
  debtLocked = false,
  onClose,
  onSaved,
}: {
  campaign?: CampaignInfo;
  /** Decimal places can't change once loot or petty cash exists. */
  decimalsLocked?: boolean;
  /** Debt can't be turned off while characters still owe. */
  debtLocked?: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(campaign?.name ?? "");
  const [startDate, setStartDate] = useState(campaign?.startDate ?? today());
  const [currencyLabel, setLabel] = useState(campaign?.currencyLabel ?? "gp");
  const [currencyDecimals, setDecimals] = useState(campaign?.currencyDecimals ?? 2);
  const [baseReferenceUrl, setReferenceUrl] = useState(campaign?.baseReferenceUrl ?? "");
  const [allowDebt, setAllowDebt] = useState(campaign?.allowDebt ?? false);
  // The hold is a whole number of the currency, stored in minor units.
  const [hold, setHold] = useState(
    String((campaign?.pettyCashHold ?? 0) / 10 ** (campaign?.currencyDecimals ?? 2)),
  );
  const [image, setImage] = useState<File | null>(null);
  const allowDebtId = useId();
  const debtLockedNow = debtLocked && allowDebt;
  const s = useSubmit();
  // The selector just reflects the fields; editing one by hand shows "Custom".
  const system = matchGameSystem({ currencyLabel, currencyDecimals, baseReferenceUrl });

  const pickSystem = (id: string) => {
    const g = GAME_SYSTEMS.find((g) => g.id === id);
    if (!g) return;
    setLabel(g.currencyLabel);
    setDecimals(g.currencyDecimals);
    setReferenceUrl(g.baseReferenceUrl);
  };

  const parsedHold = parseAmount(hold, 0);
  const holdError = parsedHold === undefined ? "Enter a whole number." : s.fields.pettyCashHold;

  const submit = () =>
    s.run(async () => {
      if (parsedHold === undefined) return;
      const body = {
        name,
        startDate,
        currencyLabel,
        currencyDecimals,
        baseReferenceUrl,
        allowDebt,
        pettyCashHold: (parsedHold ?? 0) * 10 ** currencyDecimals,
      };
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
      <div className="w-80 max-w-full md:w-[42rem]">
        <FormError message={s.hasFieldErrors ? null : s.message} />
        <div className="grid gap-x-8 md:grid-cols-2">
          <div>
            <Field label="Name" error={s.fields.name}>
              <input
                className={withError("input w-full", s.fields.name)}
                data-autofocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label="Game system"
              hint={
                decimalsLocked
                  ? "Fills in the fields below. Systems with other decimal places are unavailable once loot or petty cash is recorded."
                  : "Fills in the fields below."
              }
            >
              <select
                className="select w-full"
                value={system?.id ?? ""}
                onChange={(e) => pickSystem(e.target.value)}
              >
                <option value="">Custom</option>
                {GAME_SYSTEMS.map((g) => (
                  <option
                    key={g.id}
                    value={g.id}
                    disabled={decimalsLocked && g.currencyDecimals !== currencyDecimals}
                  >
                    {g.name}
                  </option>
                ))}
              </select>
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
                hint={decimalsLocked ? "Locked once loot or petty cash is recorded." : undefined}
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
          </div>
          <div>
            <Field label="Start date" error={s.fields.startDate}>
              <input
                type="date"
                className={withError("input w-full", s.fields.startDate)}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>
            <Field
              label={`Petty cash hold (${currencyLabel || "value"})`}
              error={holdError}
              hint="Each split tops petty cash up to this from the loot, or pays out anything above it, to keep money aside for shared costs like inns and potions."
            >
              <input
                type="number"
                min={0}
                step={1}
                className={withError("input w-32", holdError)}
                value={hold}
                onChange={(e) => setHold(e.target.value)}
              />
            </Field>
            <div className="fieldset py-1">
              <label htmlFor={allowDebtId} className="fieldset-legend pb-1">
                Allow debt
              </label>
              <div className="flex items-start gap-2">
                <input
                  id={allowDebtId}
                  type="checkbox"
                  className="checkbox checkbox-sm mt-0.5"
                  disabled={debtLockedNow}
                  checked={allowDebt}
                  aria-invalid={s.fields.allowDebt ? true : undefined}
                  aria-describedby={`${allowDebtId}-note`}
                  onChange={(e) => setAllowDebt(e.target.checked)}
                />
                <p
                  id={`${allowDebtId}-note`}
                  className={`text-xs leading-snug ${s.fields.allowDebt ? "text-error" : "text-base-content/60"}`}
                >
                  {s.fields.allowDebt ??
                    (debtLockedNow
                      ? "Locked while characters carry debt."
                      : "When a character's claims are worth more than their share, a split carries the " +
                        "difference forward as debt, taken off their later payouts. Otherwise the split can't run.")}
                </p>
              </div>
            </div>
            <Field label={campaign?.backgroundImage ? "Replace background image" : "Background image"} hint="Optional. PNG, JPEG or WebP, up to 5 MB.">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="file-input w-full"
                onChange={(e) => setImage(e.target.files?.[0] ?? null)}
              />
            </Field>
          </div>
        </div>
      </div>
    </Modal>
  );
}
