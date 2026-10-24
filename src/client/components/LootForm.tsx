import { useId, useState } from "react";
import { api } from "../api.ts";
import { parseAmount, subtotal, toInput, formatMoney } from "../../shared/money.ts";
import {
  CHARACTER_STATUSES,
  LOOT_STATUSES,
  STATUS_LABEL,
  type LootStatus,
} from "../../shared/status.ts";
import type { CampaignView, LootView } from "../../shared/types.ts";
import { Field, FormError, withError } from "./Field.tsx";
import { Modal } from "./Modal.tsx";
import { ReferenceLink } from "./ReferenceLink.tsx";
import { CancelButton, SubmitButton } from "./SubmitButton.tsx";
import { useSubmit } from "./useSubmit.ts";

/** GM form for adding loot to a session or editing an item. */
export function LootForm({
  view,
  item,
  defaultSessionId,
  onClose,
  onSaved,
}: {
  view: CampaignView;
  item?: LootView;
  defaultSessionId?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { campaign } = view;
  const decimals = campaign.currencyDecimals;
  const [sessionId, setSessionId] = useState(item?.sessionId ?? defaultSessionId ?? view.sessions[0]?.id ?? 0);
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [link, setLink] = useState(item?.link ?? "");
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [value, setValue] = useState(toInput(item?.value ?? null, decimals));
  const [marketPct, setMarketPct] = useState(String(item?.marketPct ?? 50));
  const [unidentified, setUnidentified] = useState(item?.unidentified ?? false);
  const unidentifiedId = useId();
  const [status, setStatus] = useState<LootStatus>(item?.status ?? "available");
  const [characterId, setCharacterId] = useState<string | null>(item?.characterId ?? null);
  const [added, setAdded] = useState(0);
  const s = useSubmit();

  const parsedValue = parseAmount(value, decimals);
  const needsCharacter = CHARACTER_STATUSES.includes(status);
  const preview = subtotal(Number(quantity) || 0, parsedValue ?? null, Number(marketPct) || 0);
  const valueError =
    parsedValue === undefined
      ? decimals === 0
        ? "Enter a whole number."
        : `Enter an amount with up to ${decimals} decimal places.`
      : s.fields.value;

  const save = (again: boolean) =>
    s.run(async () => {
      if (parsedValue === undefined) return;
      const body = {
        name,
        description: description || null,
        link: link || null,
        quantity: Number(quantity),
        value: parsedValue,
        marketPct: Number(marketPct),
        unidentified,
        status,
        characterId: needsCharacter ? characterId : null,
      };
      if (item) await api.patch(`/api/loot/${item.id}`, body);
      else await api.post(`/api/sessions/${sessionId}/loot`, body);
      onSaved();
      if (again) {
        setName("");
        setDescription("");
        setLink("");
        setQuantity("1");
        setValue("");
        setUnidentified(false);
        setAdded((n) => n + 1);
      } else onClose();
    });

  return (
    <Modal
      title={item ? "Edit loot" : "Add loot"}
      onClose={onClose}
      onSubmit={() => save(false)}
      actions={
        <>
          <CancelButton onClick={onClose} />
          {!item && (
            <button type="button" className="btn" disabled={s.busy} onClick={() => save(true)}>
              Save and add another
            </button>
          )}
          <SubmitButton busy={s.busy}>{item ? "Save item" : "Add item"}</SubmitButton>
        </>
      }
    >
      <div className="w-[34rem] max-w-full">
        <FormError message={s.hasFieldErrors ? null : s.message} />
        {added > 0 && !s.message && (
          <div role="status" className="alert alert-success alert-soft mb-2 py-2">
            Added {added} {added === 1 ? "item" : "items"}.
          </div>
        )}
        {!item && (
          <Field label="Session">
            <select className="select w-full" value={sessionId} onChange={(e) => setSessionId(Number(e.target.value))}>
              {view.sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.date}
                  {s.title ? ` — ${s.title}` : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <Field label="Name" error={s.fields.name}>
            <input
              className={withError("input w-full", s.fields.name)}
              data-autofocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="fieldset py-1">
            <label htmlFor={unidentifiedId} className="fieldset-legend pb-1">
              Unidentified
            </label>
            <div className="flex items-start gap-2">
              <input
                id={unidentifiedId}
                type="checkbox"
                className="checkbox checkbox-sm mt-0.5"
                checked={unidentified}
                aria-describedby={`${unidentifiedId}-note`}
                onChange={(e) => setUnidentified(e.target.checked)}
              />
              <p id={`${unidentifiedId}-note`} className="text-xs leading-snug text-base-content/60">
                Players see only its name and can't claim it. It's worth nothing in totals and splits until
                identified.
              </p>
            </div>
          </div>
        </div>
        <Field label="Description" error={s.fields.description}>
          <textarea
            className="textarea w-full"
            rows={2}
            placeholder="Optional"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <ReferenceLink
          campaign={campaign}
          name={name}
          link={link}
          error={s.fields.link}
          onChange={setLink}
          onPick={(m) => {
            setLink(m.url);
            if (m.value !== null) setValue(toInput(m.value, decimals));
          }}
        />
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-3">
          <Field label="Quantity" error={s.fields.quantity}>
            <input
              type="number"
              min={1}
              step={1}
              className={withError("input w-full", s.fields.quantity)}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Field label={`Value each (${campaign.currencyLabel || "value"})`} error={valueError}>
            <input
              inputMode="decimal"
              className={withError("input w-full", valueError)}
              placeholder="Unknown"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <Field label="Market %" error={s.fields.marketPct}>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              className={withError("input w-full", s.fields.marketPct)}
              value={marketPct}
              onChange={(e) => setMarketPct(e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <Field label="Status" error={s.fields.status}>
            <select
              className="select w-full"
              value={status}
              onChange={(e) => setStatus(e.target.value as LootStatus)}
            >
              {LOOT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {STATUS_LABEL[st]}
                </option>
              ))}
            </select>
          </Field>
          {needsCharacter && (
            <Field label="Character" error={s.fields.characterId}>
              <select
                className={withError("select w-full", s.fields.characterId)}
                value={characterId ?? ""}
                onChange={(e) => setCharacterId(e.target.value || null)}
              >
                <option value="">Choose…</option>
                {view.characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <p className="mt-1 text-sm text-base-content/70">
          Subtotal at market:{" "}
          <span className="font-semibold tabular-nums">
            {formatMoney(preview, decimals, campaign.currencyLabel)}
          </span>
        </p>
      </div>
    </Modal>
  );
}
