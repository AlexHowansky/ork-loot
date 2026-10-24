import { useState } from "react";
import { api } from "../api.ts";
import type { CharacterView, LootView, SessionView, CampaignInfo } from "../../shared/types.ts";
import { formatMoney, subtotal } from "../../shared/money.ts";
import { Field, FormError, withError } from "./Field.tsx";
import { Modal } from "./Modal.tsx";
import { CancelButton, SubmitButton } from "./SubmitButton.tsx";
import { useSubmit } from "./useSubmit.ts";
import { useConfirm } from "./Confirm.tsx";

export function CharacterForm({
  campaignId,
  character,
  claimCount = 0,
  onClose,
  onSaved,
}: {
  campaignId: string;
  character?: CharacterView;
  /** How many loot rows the character has claimed. */
  claimCount?: number;
  onClose: () => void;
  onSaved: (released: number) => void;
}) {
  const [name, setName] = useState(character?.name ?? "");
  const [shares, setShares] = useState(String(character?.shares ?? 1));
  const s = useSubmit();
  const ask = useConfirm();
  const submit = async () => {
    const body = { name, shares: Number(shares) };
    // A character without shares can't hold claims; the server releases them.
    if (character && body.shares === 0 && claimCount > 0) {
      const ok = await ask({
        title: "Release their claims?",
        message: (
          <p>
            With no shares, <strong>{character.name}</strong> can't claim loot. Their {claimCount}{" "}
            {claimCount === 1 ? "claim goes" : "claims go"} back to the pool.
          </p>
        ),
        confirmLabel: "Release claims and save",
        danger: true,
      });
      if (!ok) return;
    }
    await s.run(async () => {
      if (character) {
        const res = await api.patch<{ released: number }>(`/api/characters/${character.id}`, body);
        onSaved(res.released);
      } else {
        await api.post(`/api/campaigns/${campaignId}/characters`, body);
        onSaved(0);
      }
      onClose();
    });
  };
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
          <input className={withError("input w-full", s.fields.name)} data-autofocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Shares" error={s.fields.shares} hint="How many shares of each split this character gets. Use 0 for a character who sits splits out; they can't claim loot.">
          <input
            type="number"
            min={0}
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
  campaignId: string;
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
          <input className="input w-full" placeholder="Optional" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Notes" error={s.fields.notes}>
          <textarea className="textarea w-full" rows={3} placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** Asks a player how many of a stack to claim. */
/**
 * Asks how many of a stack to claim. A player claims for their own
 * character; the GM passes `characters` and picks who the claim is for.
 */
export function ClaimForm({
  item,
  campaign,
  characterId,
  characters,
  onClose,
  onSaved,
}: {
  item: LootView;
  campaign: CampaignInfo;
  onClose: () => void;
  onSaved: (characterName?: string) => void;
} & ({ characterId: string; characters?: never } | { characterId?: never; characters: CharacterView[] })) {
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [forId, setForId] = useState(characters?.[0]?.id ?? "");
  const s = useSubmit();
  const n = Number(quantity);
  const qtyValid = Number.isInteger(n) && n >= 1 && n <= item.quantity;
  const valid = qtyValid && (!characters || forId !== "");
  const forName = characters?.find((c) => c.id === forId)?.name;
  const submit = () =>
    s.run(async () => {
      if (characters) {
        await api.post(`/api/loot/${item.id}/claim`, { characterId: forId, quantity: n });
      } else {
        await api.post(`/api/play/${characterId}/claim`, { lootId: item.id, quantity: n });
      }
      onSaved(forName);
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
            {forName ? ` for ${forName}` : ""}
          </SubmitButton>
        </>
      }
    >
      <div className="w-72 max-w-full">
        <FormError message={s.hasFieldErrors ? null : s.message} />
        {characters && (
          <Field label="For which character?" error={s.fields.characterId}>
            <select
              className={withError("select w-full", s.fields.characterId)}
              value={forId}
              data-autofocus
              onChange={(e) => setForId(e.target.value)}
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {item.quantity > 1 && (
          <Field
            label={`How many? (${item.quantity} available)`}
            error={qtyValid ? s.fields.quantity : `Choose 1 to ${item.quantity}.`}
          >
            <input
              type="number"
              min={1}
              max={item.quantity}
              step={1}
              data-autofocus={characters ? undefined : true}
              className={withError("input w-28", qtyValid ? undefined : "x")}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
        )}
        {valid && (
          <p className="text-sm text-base-content/70">
            {formatMoney(subtotal(n, item.value, item.marketPct), campaign.currencyDecimals, campaign.currencyLabel)}{" "}
            will come off {forName ? `${forName}'s` : "your"} share.
          </p>
        )}
      </div>
    </Modal>
  );
}
