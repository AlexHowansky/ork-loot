import { z } from "zod";
import { LOOT_STATUSES } from "./status.ts";
import { MAX_DECIMALS, MAX_MONEY } from "./money.ts";

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

/** An optional http(s) URL; other schemes such as javascript: are refused. */
const optionalLink = z
  .string()
  .trim()
  .max(2000, { error: "Keep the link to 2000 characters." })
  .nullish()
  .transform((s) => (s ? s : null))
  .refine((s) => s === null || isWebUrl(s), {
    error: "Use a web address starting with http:// or https://.",
  });

function isWebUrl(s: string): boolean {
  try {
    const { protocol } = new URL(s);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** A GM's email address, which is also their sign-in name; kept in lowercase. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, { error: "Enter your email address." })
  .pipe(z.email({ error: "Enter a valid email address, like name@example.com." }));

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;

const tooLong = { error: `Keep the password to ${MAX_PASSWORD} characters.` };

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: "Enter your password." }).max(MAX_PASSWORD, tooLong),
});

/** A password being chosen, as opposed to one being checked. */
export const newPasswordSchema = z
  .string({ error: "Enter a new password." })
  .min(MIN_PASSWORD, { error: `Passwords must be at least ${MIN_PASSWORD} characters.` })
  .max(MAX_PASSWORD, tooLong);

export const forgotSchema = z.object({ email: emailSchema });

export const resetSchema = z.object({
  token: z.string().min(1).max(100),
  password: newPasswordSchema,
});

export const joinSchema = z.object({
  code: z
    .string()
    .transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .pipe(z.string().min(1, { error: "Enter your join code." })),
});

export const campaignSchema = z
  .object({
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
    baseReferenceUrl: optionalLink,
    allowDebt: z.boolean().default(false),
    /** In minor units, but always a whole number of the currency. */
    pettyCashHold: z
      .int({ error: "Petty cash hold isn't a valid amount." })
      .min(0, { error: "Petty cash hold can't be negative." })
      .max(MAX_MONEY, { error: "That petty cash hold is too large." })
      .default(0),
  })
  .refine((c) => c.pettyCashHold % 10 ** c.currencyDecimals === 0, {
    path: ["pettyCashHold"],
    error: "Petty cash hold must be a whole number.",
  });

export const characterSchema = z.object({
  name: name("Name"),
  shares: z
    .int({ error: "Shares must be a whole number." })
    .min(0, { error: "Shares can't be negative." })
    .max(100, { error: "Shares must be 100 or fewer." })
    .default(1),
});

export const observerSchema = z.object({
  name: name("Name"),
});

export const sessionSchema = z.object({
  date: isoDate,
  title: optionalText(100),
  notes: optionalText(2000),
});

const lootFields = z.object({
  name: name("Name", 200),
  location: optionalText(100),
  description: optionalText(2000),
  link: optionalLink,
  quantity: z
    .int({ error: "Quantity must be a whole number." })
    .min(1, { error: "Quantity must be at least 1." })
    .max(1_000_000),
  value: z
    .int({ error: "Value isn't a valid amount." })
    .min(0, { error: "Value can't be negative." })
    .max(MAX_MONEY, { error: "That value is too large." })
    .nullable(),
  marketPct: z
    .int({ error: "Market % must be a whole number." })
    .min(0, { error: "Market % must be 0 to 100." })
    .max(100, { error: "Market % must be 0 to 100." }),
  unidentified: z.boolean(),
  status: z.enum(LOOT_STATUSES),
  characterId: z.uuid({ error: "Choose a character." }).nullable(),
});

export const lootSchema = lootFields.extend({
  quantity: lootFields.shape.quantity.default(1),
  value: lootFields.shape.value.default(null),
  marketPct: lootFields.shape.marketPct.default(50),
  unidentified: lootFields.shape.unidentified.default(false),
  status: lootFields.shape.status.default("available"),
  characterId: lootFields.shape.characterId.default(null),
});

/** Partial updates: fields left out keep their stored values. */
export const lootUpdateSchema = lootFields.partial();

export const claimSchema = z.object({
  lootId: z.int(),
  quantity: z.int().min(1, { error: "Claim at least 1." }),
});

export const releaseSchema = z.object({ lootId: z.int() });

/** The GM claiming loot on a character's behalf. */
export const gmClaimSchema = claimSchema.omit({ lootId: true }).extend({
  characterId: z.uuid({ error: "Choose a character." }),
});

/** A hand-written petty cash adjustment: paid in, or out when negative. */
export const pettyCashEntrySchema = z.object({
  sessionId: z.int({ error: "Choose a session." }),
  description: name("Description", 200),
  amount: z
    .int({ error: "Amount isn't a valid amount." })
    .min(-MAX_MONEY, { error: "That amount is too large." })
    .max(MAX_MONEY, { error: "That amount is too large." })
    .refine((n) => n !== 0, { error: "Amount can't be zero." }),
});

/** An entry that has no session (its own was deleted) may stay without one. */
export const pettyCashEntryUpdateSchema = pettyCashEntrySchema.extend({
  sessionId: pettyCashEntrySchema.shape.sessionId.nullable(),
});

export type CampaignInput = z.infer<typeof campaignSchema>;
export type CharacterInput = z.infer<typeof characterSchema>;
export type ObserverInput = z.infer<typeof observerSchema>;
export type SessionInput = z.infer<typeof sessionSchema>;
export type LootInput = z.infer<typeof lootSchema>;
export type PettyCashEntryInput = z.infer<typeof pettyCashEntrySchema>;
