import { useState } from "react";
import { api } from "../api.ts";
import type { CharacterView, LootView, SessionView, CampaignInfo } from "../../shared/types.ts";
import { formatMoney, subtotal } from "../../shared/money.ts";
import { Field, FormError, withError } from "./Field.tsx";
import { Modal } from "./Modal.tsx";
import { CancelButton, SubmitButton } from "./SubmitButton.tsx";
import { useSubmit } from "./useSubmit.ts";

export function CharacterForm({
  campaignId,
  character,
  onClose,
  onSaved,
}: {
  campaignId: number;
  character?: CharacterView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(character?.name ?? "");
  const [shares, setShares] = useState(String(character?.shares ?? 1));
  const s = useSubmit();
  const submit = () =>
    s.run(async () => {
      const body = { name, shares: Number(shares) };
      if (character) await api.patch(`/api/characters/${character.id}`, body);
      else await api.post(`/api/campaigns/${campaignId}/characters`, body);
      onSaved();
      onClose();
    });
  return (
    <Modal
      title={character ? "Edit character" : "Add character"}
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <CancelButton onClick={onClose} />
          <SubmitButton busy={s.busy}>{character ? "Save character" : "Add character"}</SubmitButton>
        </>
      }
    >
      <div className="w-72 max-w-full">
        <FormError message={s.hasFieldErrors ? null : s.message} />
        <Field label="Name" error={s.fields.name}>
          <input className={withError("input w-full", s.fields.name)} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Shares" error={s.fields.shares} hint="How many shares of each split this character gets.">
          <input
            type="number"
            min={1}
            step={1}
            className={withError("input w-24", s.fields.shares)}
            value={shares}
            onChange={(e) => setShares(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

export function SessionForm({
  campaignId,
  session,
  onClose,
  onSaved,
}: {
  campaignId: number;
  session?: SessionView;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const [date, setDate] = useState(session?.date ?? today());
  const [title, setTitle] = useState(session?.title ?? "");
  const [notes, setNotes] = useState(session?.notes ?? "");
  const s = useSubmit();
  const submit = () =>
    s.run(async () => {
      const body = { date, title: title || null, notes: notes || null };
      const saved = session
        ? await api.patch<{ id: number }>(`/api/sessions/${session.id}`, body)
        : await api.post<{ id: number }>(`/api/campaigns/${campaignId}/sessions`, body);
      onSaved(saved.id);
      onClose();
    });
  return (
    <Modal
      title={session ? "Edit session" : "New session"}
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <CancelButton onClick={onClose} />
          <SubmitButton busy={s.busy}>{session ? "Save session" : "Create session"}</SubmitButton>
        </>
      }
    >
      <div className="w-80 max-w-full">
        <FormError message={s.hasFieldErrors ? null : s.message} />
        <Field label="Date" error={s.fields.date}>
          <input type="date" className={withError("input w-full", s.fields.date)} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Title" error={s.fields.title}>
          <input className="input w-full" placeholder="Optional" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Notes" error={s.fields.notes}>
          <textarea className="textarea w-full" rows={3} placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** Asks a player how many of a stack to claim. */
export function ClaimForm({
  item,
  campaign,
  characterId,
  onClose,
  onSaved,
}: {
  item: LootView;
  campaign: CampaignInfo;
  characterId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [quantity, setQuantity] = useState(String(item.quantity));
  const s = useSubmit();
  const n = Number(quantity);
  const valid = Number.isInteger(n) && n >= 1 && n <= item.quantity;
  const submit = () =>
    s.run(async () => {
      await api.post(`/api/play/${characterId}/claim`, { lootId: item.id, quantity: n });
      onSaved();
      onClose();
    });
  return (
    <Modal
      title={`Claim ${item.name}`}
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <CancelButton onClick={onClose} />
          <SubmitButton busy={s.busy} disabled={!valid}>
            Claim {valid ? n : ""}
          </SubmitButton>
        </>
      }
    >
      <div className="w-72 max-w-full">
        <FormError message={s.hasFieldErrors ? null : s.message} />
        <Field
          label={`How many? (${item.quantity} available)`}
          error={valid ? s.fields.quantity : `Choose 1 to ${item.quantity}.`}
        >
          <input
            type="number"
            min={1}
            max={item.quantity}
            step={1}
            autoFocus
            className={withError("input w-28", valid ? undefined : "x")}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        {valid && (
          <p className="text-sm text-base-content/70">
            {formatMoney(subtotal(n, item.value, item.marketPct), campaign.currencyDecimals, campaign.currencyLabel)}{" "}
            will come off your share.
          </p>
        )}
      </div>
    </Modal>
  );
}
