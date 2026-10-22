import { z } from "zod";
import { LOOT_STATUSES } from "./status.ts";
import { MAX_DECIMALS } from "./money.ts";

const name = (label: string, max = 100) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, { error: `${label} is required.` })
    .max(max, { error: `${label} must be at most ${max} characters.` });

const isoDate = z
  .string({ error: "Date is required." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Use a date like 2026-10-20." })
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    error: "That isn't a real date.",
  });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Must be at most ${max} characters.` })
    .nullish()
    .transform((s) => (s ? s : null));

export const loginSchema = z.object({
  username: z.string().trim().min(1, { error: "Enter your username." }),
  password: z.string().min(1, { error: "Enter your password." }),
});

export const joinSchema = z.object({
  code: z
    .string()
    .transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .pipe(z.string().min(1, { error: "Enter your join code." })),
});

export const campaignSchema = z.object({
  name: name("Name"),
  startDate: isoDate,
  currencyLabel: z
    .string()
    .trim()
    .max(10, { error: "Keep the currency label to 10 characters." }),
  currencyDecimals: z
    .int({ error: "Decimals must be a whole number." })
    .min(0)
    .max(MAX_DECIMALS, { error: `Decimals must be 0 to ${MAX_DECIMALS}.` }),
});

export const characterSchema = z.object({
  name: name("Name"),
  shares: z
    .int({ error: "Shares must be a whole number." })
    .min(1, { error: "A character needs at least 1 share." })
    .max(100, { error: "Shares must be 100 or fewer." })
    .default(1),
});

export const sessionSchema = z.object({
  date: isoDate,
  title: optionalText(100),
  notes: optionalText(2000),
});

const lootFields = z.object({
  name: name("Name", 200),
  description: optionalText(2000),
  quantity: z
    .int({ error: "Quantity must be a whole number." })
    .min(1, { error: "Quantity must be at least 1." })
    .max(1_000_000),
  value: z
    .int({ error: "Value isn't a valid amount." })
    .min(0, { error: "Value can't be negative." })
    .nullable(),
  marketPct: z
    .int({ error: "Market % must be a whole number." })
    .min(0, { error: "Market % must be 0 to 100." })
    .max(100, { error: "Market % must be 0 to 100." }),
  status: z.enum(LOOT_STATUSES),
  characterId: z.int().nullable(),
});

export const lootSchema = lootFields.extend({
  quantity: lootFields.shape.quantity.default(1),
  value: lootFields.shape.value.default(null),
  marketPct: lootFields.shape.marketPct.default(50),
  status: lootFields.shape.status.default("active"),
  characterId: lootFields.shape.characterId.default(null),
});

/** Partial updates: fields left out keep their stored values. */
export const lootUpdateSchema = lootFields.partial();

export const claimSchema = z.object({
  lootId: z.int(),
  quantity: z.int().min(1, { error: "Claim at least 1." }),
});

export const releaseSchema = z.object({ lootId: z.int() });

export type CampaignInput = z.infer<typeof campaignSchema>;
export type CharacterInput = z.infer<typeof characterSchema>;
export type SessionInput = z.infer<typeof sessionSchema>;
export type LootInput = z.infer<typeof lootSchema>;
