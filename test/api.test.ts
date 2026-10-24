import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  addGm,
  Client,
  makeApp,
  ORIGIN,
  referenceCalls,
  sentMail,
  setReferenceReply,
} from "./helpers.ts";
import { campaign, passwordReset } from "../src/server/db/schema.ts";
import type { CampaignView, CharacterView, LiveNotice, PlayView } from "../src/shared/types.ts";

let ctx: ReturnType<typeof makeApp>;
let gmA: Client;

beforeEach(async () => {
  ctx = makeApp();
  await addGm(ctx.db, "alice@example.com");
  await addGm(ctx.db, "bob@example.com");
  gmA = new Client(ctx.app);
  expect((await gmA.login("alice@example.com")).status).toBe(200);
});

const campaignBody = {
  name: "Rise of the Runelords",
  startDate: "2026-01-05",
  currencyLabel: "gp",
  currencyDecimals: 2,
};

/** A campaign with three characters (shares 1, 1, 2) and one session. */
async function seed() {
  const c = (await gmA.post("/api/campaigns", campaignBody)).body;
  const ids: string[] = [];
  for (const [name, shares] of [["Amiri", 1], ["Ezren", 1], ["Valeros", 2]] as const) {
    ids.push((await gmA.post(`/api/campaigns/${c.id}/characters`, { name, shares })).body.id);
  }
  const s = (await gmA.post(`/api/campaigns/${c.id}/sessions`, { date: "2026-01-05" })).body;
  const view = async () => (await gmA.get<CampaignView>(`/api/campaigns/${c.id}`)).body;
  return { campaignId: c.id as string, characterIds: ids, sessionId: s.id as number, view };
}

async function join(code: string, ip?: string) {
  const player = new Client(ctx.app, ip);
  const res = await player.post("/api/join", { code });
  return { player, res };
}

describe("auth", () => {
  test("rejects a wrong password with a friendly message", async () => {
    const res = await new Client(ctx.app).login("alice@example.com", "nope");
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("don't match");
  });

  test("unknown users get the same message", async () => {
    const res = await new Client(ctx.app).login("mallory@example.com", "nope");
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("don't match");
  });

  test("signs in by email address, ignoring case and spaces", async () => {
    const res = await new Client(ctx.app).login("  Alice@Example.COM ");
    expect(res.status).toBe(200);
    expect(res.body.gm.email).toBe("alice@example.com");
  });

  test("refuses a sign-in name that isn't an email address", async () => {
    const res = await new Client(ctx.app).login("alice");
    expect(res.status).toBe(400);
    expect(res.body.fields.email).toContain("valid email address");
  });

  test("logout ends the session", async () => {
    await gmA.post("/api/auth/logout");
    expect((await gmA.get("/api/campaigns")).status).toBe(401);
  });

  test("rate limits login attempts", async () => {
    const c = new Client(ctx.app, "10.9.9.9");
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await c.login("alice@example.com", "wrong")).status;
    expect(last).toBe(429);
  });

  test("blocks cross-origin writes", async () => {
    const res = await gmA.raw("POST", "/api/campaigns", {
      headers: { origin: "https://evil.test", "content-type": "application/json" },
      body: JSON.stringify(campaignBody),
    });
    expect(res.status).toBe(403);
  });

  test("blocks form-encoded writes", async () => {
    const res = await gmA.raw("POST", "/api/campaigns", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=x",
    });
    expect(res.status).toBe(415);
  });
});

describe("password reset", () => {
  const NEW_PASSWORD = "a brand new password";

  /** Asks for a reset link and returns the token from the email. */
  async function requestReset(email = "alice@example.com") {
    const res = await new Client(ctx.app).post("/api/auth/forgot", { email });
    expect(res.status).toBe(200);
    const link = sentMail.at(-1)!.text.match(/https?:\/\/\S+/)![0];
    expect(link.startsWith(`${ORIGIN}/reset#`)).toBe(true);
    return link.slice(link.indexOf("#") + 1);
  }

  test("emails a reset link to a GM", async () => {
    await requestReset("  Alice@Example.COM ");
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]!.to).toBe("alice@example.com");
  });

  test("answers the same for unknown addresses and sends nothing", async () => {
    const res = await new Client(ctx.app).post("/api/auth/forgot", {
      email: "mallory@example.com",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sentMail).toHaveLength(0);
  });

  test("sets the new password, signs in, and signs out elsewhere", async () => {
    const token = await requestReset();
    const browser = new Client(ctx.app);
    const res = await browser.post("/api/auth/reset", { token, password: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.gm.email).toBe("alice@example.com");
    expect((await browser.get("/api/campaigns")).status).toBe(200);
    expect((await gmA.get("/api/campaigns")).status).toBe(401);
    expect((await new Client(ctx.app).login("alice@example.com")).status).toBe(401);
    expect((await new Client(ctx.app).login("alice@example.com", NEW_PASSWORD)).status).toBe(200);
  });

  test("a link works only once", async () => {
    const token = await requestReset();
    const c = new Client(ctx.app);
    expect((await c.post("/api/auth/reset", { token, password: NEW_PASSWORD })).status).toBe(200);
    const again = await c.post("/api/auth/reset", { token, password: "yet another password" });
    expect(again.status).toBe(400);
    expect(again.body.error).toContain("expired or was already used");
  });

  test("a newer link replaces an older one", async () => {
    const first = await requestReset();
    await requestReset();
    const res = await new Client(ctx.app).post("/api/auth/reset", {
      token: first,
      password: NEW_PASSWORD,
    });
    expect(res.status).toBe(400);
  });

  test("an expired link is refused", async () => {
    const token = await requestReset();
    ctx.db.update(passwordReset).set({ expiresAt: new Date(Date.now() - 1000) }).run();
    const res = await new Client(ctx.app).post("/api/auth/reset", {
      token,
      password: NEW_PASSWORD,
    });
    expect(res.status).toBe(400);
    expect((await new Client(ctx.app).login("alice@example.com")).status).toBe(200);
  });

  test("refuses a short password", async () => {
    const token = await requestReset();
    const res = await new Client(ctx.app).post("/api/auth/reset", { token, password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.fields.password).toContain("at least 10 characters");
  });

  test("rate limits reset requests", async () => {
    const c = new Client(ctx.app, "10.9.9.8");
    let last = 0;
    for (let i = 0; i < 7; i++) {
      last = (await c.post("/api/auth/forgot", { email: "mallory@example.com" })).status;
    }
    expect(last).toBe(429);
  });
});

describe("campaign access", () => {
  test("one GM can't see or change another GM's campaign", async () => {
    const { campaignId, characterIds, sessionId } = await seed();
    const gmB = new Client(ctx.app);
    await gmB.login("bob@example.com");
    expect((await gmB.get(`/api/campaigns/${campaignId}`)).status).toBe(404);
    expect((await gmB.patch(`/api/campaigns/${campaignId}`, campaignBody)).status).toBe(404);
    expect((await gmB.del(`/api/campaigns/${campaignId}`)).status).toBe(404);
    expect((await gmB.post(`/api/characters/${characterIds[0]}/code`)).status).toBe(404);
    expect((await gmB.post(`/api/sessions/${sessionId}/loot`, { name: "x" })).status).toBe(404);
    expect((await gmB.get("/api/campaigns")).body).toEqual([]);
  });

  test("campaign, GM and character ids are UUIDs, not counters", async () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const { campaignId, characterIds } = await seed();
    expect(campaignId).toMatch(uuid);
    for (const id of characterIds) expect(id).toMatch(uuid);
    expect((await gmA.get("/api/auth/me")).body.gm.id).toMatch(uuid);
    expect((await gmA.get("/api/campaigns/1")).status).toBe(404);
    expect((await gmA.get(`/api/campaigns/${campaignId.toUpperCase()}`)).status).toBe(200);
  });

  test("validates input with field messages", async () => {
    const res = await gmA.post("/api/campaigns", { ...campaignBody, name: "", startDate: "x" });
    expect(res.status).toBe(400);
    expect(res.body.fields.name).toBe("Name is required.");
    expect(res.body.fields.startDate).toBeDefined();
  });

  test("campaign base reference URL is optional and must be a web address", async () => {
    const { campaignId } = await seed();
    expect((await gmA.get(`/api/campaigns/${campaignId}`)).body.campaign.baseReferenceUrl).toBeNull();
    const ok = await gmA.patch(`/api/campaigns/${campaignId}`, {
      ...campaignBody,
      baseReferenceUrl: "https://2e.aonprd.com/",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.baseReferenceUrl).toBe("https://2e.aonprd.com/");
    const bad = await gmA.patch(`/api/campaigns/${campaignId}`, { ...campaignBody, baseReferenceUrl: "javascript:alert(1)" });
    expect(bad.status).toBe(400);
    expect(bad.body.fields.baseReferenceUrl).toBeDefined();
    const cleared = await gmA.patch(`/api/campaigns/${campaignId}`, { ...campaignBody, baseReferenceUrl: "" });
    expect(cleared.body.baseReferenceUrl).toBeNull();
  });

  test("character names are unique within a campaign", async () => {
    const { campaignId } = await seed();
    const res = await gmA.post(`/api/campaigns/${campaignId}/characters`, { name: "amiri" });
    expect(res.status).toBe(409);
  });

  test("decimals lock while petty cash is held", async () => {
    const { campaignId } = await seed();
    ctx.db.update(campaign).set({ pettyCash: 3 }).where(eq(campaign.id, campaignId)).run();
    const res = await gmA.patch(`/api/campaigns/${campaignId}`, { ...campaignBody, currencyDecimals: 0 });
    expect(res.status).toBe(400);
    expect(res.body.fields.currencyDecimals).toBeDefined();
  });

  test("petty cash starts at 0, is shown to players and can't be set by hand", async () => {
    const { campaignId, view } = await seed();
    expect((await view()).campaign.pettyCash).toBe(0);
    const res = await gmA.patch(`/api/campaigns/${campaignId}`, { ...campaignBody, pettyCash: 500 });
    expect(res.status).toBe(200);
    expect(res.body.pettyCash).toBe(0);
    const code = (await view()).characters[0]!.joinCode!;
    const { player, res: joined } = await join(code);
    const play = await player.get<PlayView>(`/api/play/${joined.body.characterId}`);
    expect(play.body.campaign.pettyCash).toBe(0);
  });

  test("decimals lock once loot exists", async () => {
    const { campaignId, sessionId } = await seed();
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Gem", value: 100 });
    const res = await gmA.patch(`/api/campaigns/${campaignId}`, { ...campaignBody, currencyDecimals: 0 });
    expect(res.status).toBe(400);
  });
});

describe("join codes", () => {
  test("a code works once and regenerating replaces it", async () => {
    const { characterIds, view } = await seed();
    const code = (await view()).characters.find((c) => c.name === "Amiri")!.joinCode!;
    expect(code).toHaveLength(10);

    const first = await join(code.toLowerCase().replace(/(.{5})/, "$1-"));
    expect(first.res.status).toBe(200);
    expect((await first.player.get("/api/auth/me")).body.characters).toHaveLength(1);

    expect((await join(code)).res.status).toBe(404);

    const fresh = (await gmA.post(`/api/characters/${characterIds[0]}/code`)).body.joinCode;
    // The old browser loses the character as soon as the new code exists.
    expect((await first.player.get(`/api/play/${characterIds[0]}`)).status).toBe(404);
    expect((await first.player.get("/api/auth/me")).body.characters).toHaveLength(0);
    const amiri = (await view()).characters.find((c) => c.name === "Amiri")!;
    expect(amiri.hasPlayer).toBe(false);

    const second = await join(fresh);
    expect(second.res.status).toBe(200);
    expect((await second.player.get(`/api/play/${characterIds[0]}`)).status).toBe(200);
  });

  test("one browser can hold several characters", async () => {
    const { view } = await seed();
    const chars = (await view()).characters;
    const { player } = await join(chars[0]!.joinCode!);
    await player.post("/api/join", { code: chars[1]!.joinCode! });
    expect((await player.get("/api/auth/me")).body.characters).toHaveLength(2);
  });

  test("players don't see join codes", async () => {
    const { view } = await seed();
    const chars = (await view()).characters;
    const { player, res } = await join(chars[0]!.joinCode!);
    const play = (await player.get<PlayView>(`/api/play/${res.body.characterId}`)).body;
    for (const c of play.characters) {
      expect(c.joinCode).toBeUndefined();
      expect(c.hasPlayer).toBeUndefined();
    }
  });
});

describe("claims", () => {
  async function withPotions() {
    const s = await seed();
    const potion = (
      await gmA.post(`/api/sessions/${s.sessionId}/loot`, {
        name: "Potion",
        quantity: 5,
        value: 5000,
      })
    ).body;
    const chars = (await s.view()).characters;
    const amiri = await join(chars.find((c) => c.name === "Amiri")!.joinCode!);
    const ezren = await join(chars.find((c) => c.name === "Ezren")!.joinCode!);
    return {
      ...s,
      potion,
      amiri: { client: amiri.player, id: amiri.res.body.characterId as string },
      ezren: { client: ezren.player, id: ezren.res.body.characterId as string },
    };
  }

  test("claiming part of a stack splits the row", async () => {
    const { potion, amiri, view } = await withPotions();
    const res = await amiri.client.post(`/api/play/${amiri.id}/claim`, { lootId: potion.id, quantity: 2 });
    expect(res.status).toBe(200);
    const loot = (await view()).loot;
    expect(loot.find((l) => l.status === "available")!.quantity).toBe(3);
    const claimed = loot.find((l) => l.status === "claimed")!;
    expect(claimed.quantity).toBe(2);
    expect(claimed.characterId).toBe(amiri.id);
  });

  test("a split stack keeps its link and merges back on release", async () => {
    const { potion, amiri, view } = await withPotions();
    await gmA.patch(`/api/loot/${potion.id}`, { link: "https://example.com/potion" });
    await amiri.client.post(`/api/play/${amiri.id}/claim`, { lootId: potion.id, quantity: 2 });
    const claimed = (await view()).loot.find((l) => l.status === "claimed")!;
    expect(claimed.link).toBe("https://example.com/potion");
    await amiri.client.post(`/api/play/${amiri.id}/release`, { lootId: claimed.id });
    expect((await view()).loot).toHaveLength(1);
  });

  test("the GM can claim part of a stack for a character and release it", async () => {
    const { potion, amiri, view } = await withPotions();
    const res = await gmA.post(`/api/loot/${potion.id}/claim`, { characterId: amiri.id, quantity: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "claimed", quantity: 2, characterId: amiri.id });
    let loot = (await view()).loot;
    expect(loot.find((l) => l.status === "available")!.quantity).toBe(3);

    expect((await gmA.post(`/api/loot/${potion.id}/release`)).status).toBe(400);
    expect((await gmA.post(`/api/loot/${res.body.id}/release`)).status).toBe(200);
    loot = (await view()).loot;
    expect(loot).toHaveLength(1);
    expect(loot[0]).toMatchObject({ status: "available", quantity: 5, characterId: null });
  });

  test("the GM can only claim for characters in the same campaign", async () => {
    const { potion } = await withPotions();
    const other = await seed();
    const res = await gmA.post(`/api/loot/${potion.id}/claim`, {
      characterId: other.characterIds[0],
      quantity: 1,
    });
    expect(res.status).toBe(400);
    expect(res.body.fields.characterId).toBeDefined();
    const gmB = new Client(ctx.app);
    await gmB.login("bob@example.com");
    expect((await gmB.post(`/api/loot/${potion.id}/claim`, { characterId: other.characterIds[0], quantity: 1 })).status).toBe(404);
  });

  test("players can't use the GM's claim routes", async () => {
    const { potion, amiri } = await withPotions();
    const res = await amiri.client.post(`/api/loot/${potion.id}/claim`, { characterId: amiri.id, quantity: 1 });
    expect(res.status).toBe(401);
  });

  test("an item claimed in full can't be claimed again", async () => {
    const { potion, amiri, ezren } = await withPotions();
    await amiri.client.post(`/api/play/${amiri.id}/claim`, { lootId: potion.id, quantity: 5 });
    const res = await ezren.client.post(`/api/play/${ezren.id}/claim`, { lootId: potion.id, quantity: 1 });
    expect(res.status).toBe(409);
  });

  test("racing claims never over-claim", async () => {
    const { potion, amiri, ezren, view } = await withPotions();
    const results = await Promise.all([
      amiri.client.post(`/api/play/${amiri.id}/claim`, { lootId: potion.id, quantity: 4 }),
      ezren.client.post(`/api/play/${ezren.id}/claim`, { lootId: potion.id, quantity: 4 }),
    ]);
    const [ok, lost] = results.map((r) => r.status).sort();
    expect(ok).toBe(200);
    expect([400, 409]).toContain(lost!);
    const total = (await view()).loot.reduce((n, l) => n + l.quantity, 0);
    expect(total).toBe(5);
  });

  test("players can't claim more than exist", async () => {
    const { potion, amiri } = await withPotions();
    const res = await amiri.client.post(`/api/play/${amiri.id}/claim`, { lootId: potion.id, quantity: 9 });
    expect(res.status).toBe(400);
  });

  test("players act only for their own characters", async () => {
    const { potion, amiri, ezren } = await withPotions();
    const res = await amiri.client.post(`/api/play/${ezren.id}/claim`, { lootId: potion.id, quantity: 1 });
    expect(res.status).toBe(404);
  });

  test("players can't use GM endpoints to set other statuses", async () => {
    const { potion, amiri, campaignId } = await withPotions();
    expect((await amiri.client.patch(`/api/loot/${potion.id}`, { status: "sold" })).status).toBe(401);
    expect((await amiri.client.post(`/api/campaigns/${campaignId}/split`)).status).toBe(401);
  });

  test("players can't claim loot from another campaign", async () => {
    const { amiri } = await withPotions();
    const other = await seed();
    const gem = (await gmA.post(`/api/sessions/${other.sessionId}/loot`, { name: "Gem" })).body;
    const res = await amiri.client.post(`/api/play/${amiri.id}/claim`, { lootId: gem.id, quantity: 1 });
    expect(res.status).toBe(404);
  });

  test("releasing merges back into the stack", async () => {
    const { potion, amiri, ezren, view } = await withPotions();
    await amiri.client.post(`/api/play/${amiri.id}/claim`, { lootId: potion.id, quantity: 2 });
    const claimed = (await view()).loot.find((l) => l.status === "claimed")!;
    expect((await ezren.client.post(`/api/play/${ezren.id}/release`, { lootId: claimed.id })).status).toBe(400);
    expect((await amiri.client.post(`/api/play/${amiri.id}/release`, { lootId: claimed.id })).status).toBe(200);
    const loot = (await view()).loot;
    expect(loot).toHaveLength(1);
    expect(loot[0]!.quantity).toBe(5);
    expect(loot[0]!.status).toBe("available");
  });
});

describe("loot split", () => {
  test("pays out by shares minus claims and updates statuses", async () => {
    const { campaignId, sessionId, view, characterIds } = await seed();
    const add = (body: object) => gmA.post(`/api/sessions/${sessionId}/loot`, body);
    // Subtotals at 50%: sword 1000, gems 3 × 200 = 600, fund 400.
    await add({ name: "Sword", value: 2000 });
    await add({ name: "Gem", quantity: 3, value: 400 });
    await add({ name: "Fund", value: 800, status: "party" });
    await add({ name: "Junk", value: 100, status: "abandoned" });
    const ring = (await add({ name: "Ring", value: 800, status: "claimed", characterId: characterIds[0] })).body;

    const before = await view();
    expect(before.pool).toEqual({ sellable: 2000, party: 400, claimed: 400, totalShares: 4, pettyCashIn: 0 });

    const preview = (await gmA.get(`/api/campaigns/${campaignId}/split/preview`)).body;
    expect(preview.total).toBe(2000);

    const res = await gmA.post(`/api/campaigns/${campaignId}/split`);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.shares.map((s: any) => [s.characterName, s]));
    expect(byName.Amiri).toMatchObject({ gross: 500, claimed: 400, net: 100 });
    expect(byName.Ezren).toMatchObject({ gross: 500, claimed: 0, net: 500 });
    expect(byName.Valeros).toMatchObject({ gross: 1000, net: 1000 });

    const after = await view();
    const status = (name: string) => after.loot.find((l) => l.name === name)!.status;
    expect(status("Sword")).toBe("sold");
    expect(status("Gem")).toBe("sold");
    expect(status("Fund")).toBe("party");
    expect(status("Junk")).toBe("abandoned");
    expect(after.loot.find((l) => l.id === ring.id)!.status).toBe("bought");
    expect(after.pool.sellable).toBe(0);
    expect(after.splits).toHaveLength(1);

    // Nothing left to split.
    expect((await gmA.post(`/api/campaigns/${campaignId}/split`)).status).toBe(400);
  });

  test("leftovers become petty cash, which the next split pays out", async () => {
    const { campaignId, sessionId, view } = await seed();
    // 4 shares; a subtotal of 1003 leaves 3 over.
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Statue", value: 2006 });

    const preview = (await gmA.get(`/api/campaigns/${campaignId}/split/preview`)).body;
    expect(preview.leftover).toBe(3);
    expect(preview.shares.map((s: any) => s.gross).sort()).toEqual([250, 250, 500]);
    expect((await view()).campaign.pettyCash).toBe(0);

    const first = (await gmA.post(`/api/campaigns/${campaignId}/split`)).body;
    expect(first.leftover).toBe(3);
    expect((await view()).campaign.pettyCash).toBe(3);

    // 1002 of loot plus 3 of petty cash is 1005: 251 a share, 1 over.
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Vase", value: 2004 });
    const before = await view();
    expect(before.characters.map((c) => c.gross).sort()).toEqual([251, 251, 502]);
    const next = (await gmA.get(`/api/campaigns/${campaignId}/split/preview`)).body;
    expect(next).toMatchObject({ total: 1005, pettyCash: 3, leftover: 1 });

    await gmA.post(`/api/campaigns/${campaignId}/split`);
    const after = await view();
    expect(after.campaign.pettyCash).toBe(1);
    expect(after.splits.map((s) => [s.total, s.leftover])).toEqual([[1005, 1], [1003, 3]]);
  });

  test("unidentified items keep their details from players and are worth nothing", async () => {
    const { campaignId, sessionId, characterIds, view } = await seed();
    const [amiri] = characterIds as [string];
    const amiriCode = (await view()).characters.find((c) => c.id === amiri)!.joinCode!;
    const { player } = await join(amiriCode);
    const add = (body: object) => gmA.post(`/api/sessions/${sessionId}/loot`, body);
    await add({ name: "Sword", value: 2000 });
    const wands = (
      await add({
        name: "Wand of Fireballs",
        description: "Shoots fire",
        link: "https://example.com/wand",
        quantity: 2,
        value: 9000,
        unidentified: true,
      })
    ).body;
    expect(wands.unidentified).toBe(true);

    // The GM sees everything, but the pool doesn't count the wands.
    const gmView = await view();
    expect(gmView.loot.find((l) => l.id === wands.id)).toMatchObject({ name: "Wand of Fireballs", value: 9000 });
    expect(gmView.pool.sellable).toBe(1000);

    const play = (await player.get<PlayView>(`/api/play/${amiri}`)).body;
    expect(play.loot.find((l) => l.id === wands.id)).toMatchObject({
      name: "Wand of Fireballs",
      description: null,
      link: null,
      value: null,
      subtotal: 0,
      unidentified: true,
    });
    expect(JSON.stringify(play)).not.toContain("Shoots fire");
    expect(JSON.stringify(play)).not.toContain("example.com/wand");

    // Players can't claim it; the GM can, and part of a stack stays unidentified.
    const mine = await player.post(`/api/play/${amiri}/claim`, { lootId: wands.id, quantity: 1 });
    expect(mine.status).toBe(400);
    expect(mine.body.error).toContain("identified");
    const claimed = await gmA.post(`/api/loot/${wands.id}/claim`, { characterId: amiri, quantity: 1 });
    expect(claimed.body).toMatchObject({ unidentified: true, status: "claimed" });
    expect((await view()).characters.find((c) => c.id === amiri)!.claimed).toBe(0);

    // A split leaves both wand rows where they were.
    expect((await gmA.post(`/api/campaigns/${campaignId}/split`)).status).toBe(200);
    let now = await view();
    expect(now.loot.filter((l) => l.unidentified).map((l) => l.status).sort()).toEqual(["available", "claimed"]);
    expect(now.loot.find((l) => l.name === "Sword")!.status).toBe("sold");

    // Identified, they count again.
    await gmA.patch(`/api/loot/${wands.id}`, { unidentified: false });
    now = await view();
    expect(now.pool.sellable).toBe(4500);
  });

  test("the latest split can be undone", async () => {
    const { campaignId, sessionId, characterIds, view } = await seed();
    const [amiri] = characterIds as [string];
    const add = (body: object) => gmA.post(`/api/sessions/${sessionId}/loot`, body);
    // 4 shares; 1003 leaves 3 of petty cash.
    await add({ name: "Statue", value: 2006 });
    await add({ name: "Ring", value: 0, status: "claimed", characterId: amiri });
    const first = (await gmA.post(`/api/campaigns/${campaignId}/split`)).body;
    expect((await view()).campaign.pettyCash).toBe(3);
    // 1002 + 3 = 1005 leaves 1.
    await add({ name: "Vase", value: 2004 });
    const second = (await gmA.post(`/api/campaigns/${campaignId}/split`)).body;
    expect(second.pettyCash).toBe(3);

    const undo = (id: number) => gmA.del(`/api/campaigns/${campaignId}/splits/${id}`);
    expect((await undo(first.id)).status).toBe(409);
    expect((await undo(second.id)).status).toBe(200);
    let now = await view();
    expect(now.splits.map((s) => s.id)).toEqual([first.id]);
    expect(now.campaign.pettyCash).toBe(3);
    expect(now.loot.find((l) => l.name === "Vase")).toMatchObject({ status: "available", splitId: null });
    expect(now.loot.find((l) => l.name === "Statue")!.status).toBe("sold");

    // A claimant who has since dropped to no shares doesn't get the claim back.
    await gmA.patch(`/api/characters/${amiri}`, { name: "Amiri", shares: 0 });
    expect((await undo(first.id)).status).toBe(200);
    now = await view();
    expect(now.splits).toHaveLength(0);
    expect(now.campaign.pettyCash).toBe(0);
    expect(now.loot.find((l) => l.name === "Statue")).toMatchObject({ status: "available", splitId: null });
    expect(now.loot.find((l) => l.name === "Ring")).toMatchObject({ status: "available", characterId: null });
    expect(now.pool.sellable).toBe(1003 + 1002);
  });

  test("an undone claim goes back to its claimant", async () => {
    const { campaignId, sessionId, characterIds, view } = await seed();
    const [amiri] = characterIds as [string];
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Sword", value: 4000 });
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Ring", value: 800, status: "claimed", characterId: amiri });
    const s = (await gmA.post(`/api/campaigns/${campaignId}/split`)).body;
    const gmB = new Client(ctx.app);
    await gmB.login("bob@example.com");
    expect((await gmB.del(`/api/campaigns/${campaignId}/splits/${s.id}`)).status).toBe(404);
    expect((await gmA.del(`/api/campaigns/${campaignId}/splits/${s.id}`)).status).toBe(200);
    expect((await view()).loot.find((l) => l.name === "Ring")).toMatchObject({ status: "claimed", characterId: amiri });
  });

  test("characters with split history can't be deleted", async () => {
    const { campaignId, sessionId, characterIds } = await seed();
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Sword", value: 2000 });
    await gmA.post(`/api/campaigns/${campaignId}/split`);
    expect((await gmA.del(`/api/characters/${characterIds[0]}`)).status).toBe(409);
  });

  test("characters with no shares sit a split out", async () => {
    const { campaignId, sessionId, characterIds, view } = await seed();
    const [amiri, ezren, valeros] = characterIds as [string, string, string];
    expect((await gmA.patch(`/api/characters/${ezren}`, { name: "Ezren", shares: 0 })).status).toBe(200);
    expect((await gmA.patch(`/api/characters/${amiri}`, { name: "Amiri", shares: -1 })).status).toBe(400);
    // Subtotals at 50%: sword 1000, ring 200 claimed by Amiri.
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Sword", value: 2000 });
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Ring", value: 400, status: "claimed", characterId: amiri });
    expect((await view()).pool.totalShares).toBe(3);

    const res = await gmA.post(`/api/campaigns/${campaignId}/split`);
    expect(res.status).toBe(200);
    // Ezren has no shares, so isn't in the split at all.
    const byName = Object.fromEntries(res.body.shares.map((s: any) => [s.characterName, s]));
    expect(Object.keys(byName).sort()).toEqual(["Amiri", "Valeros"]);
    expect(byName.Amiri).toMatchObject({ gross: 400, claimed: 200, net: 200 });
    expect(byName.Valeros).toMatchObject({ gross: 800, net: 800 });
    expect((await gmA.del(`/api/characters/${ezren}`)).status).toBe(200);
    expect((await gmA.del(`/api/characters/${valeros}`)).status).toBe(409);
  });

  test("characters with no shares can't claim", async () => {
    const { campaignId, sessionId, characterIds } = await seed();
    const [amiri] = characterIds as [string];
    const amiriCode = (await gmA.get<CampaignView>(`/api/campaigns/${campaignId}`)).body.characters.find(
      (c) => c.id === amiri,
    )!.joinCode!;
    const { player } = await join(amiriCode);
    await gmA.patch(`/api/characters/${amiri}`, { name: "Amiri", shares: 0 });
    const add = (body: object) => gmA.post(`/api/sessions/${sessionId}/loot`, body);
    const sword = (await add({ name: "Sword", value: 2000 })).body;

    const mine = await player.post(`/api/play/${amiri}/claim`, { lootId: sword.id, quantity: 1 });
    expect(mine.status).toBe(400);
    expect(mine.body.error).toContain("no shares");
    const forThem = await gmA.post(`/api/loot/${sword.id}/claim`, { characterId: amiri, quantity: 1 });
    expect(forThem.status).toBe(400);
    expect((await add({ name: "Ring", value: 400, status: "claimed", characterId: amiri })).status).toBe(400);
    expect((await gmA.patch(`/api/loot/${sword.id}`, { status: "claimed", characterId: amiri })).status).toBe(400);
  });

  test("dropping a character to no shares releases their claims", async () => {
    const { sessionId, characterIds, view } = await seed();
    const [amiri, ezren] = characterIds as [string, string];
    const add = (body: object) => gmA.post(`/api/sessions/${sessionId}/loot`, body);
    const gems = (await add({ name: "Gem", quantity: 3, value: 400 })).body;
    await gmA.post(`/api/loot/${gems.id}/claim`, { characterId: amiri, quantity: 2 });
    await add({ name: "Ring", value: 400, status: "claimed", characterId: amiri });
    await add({ name: "Wand", value: 400, status: "claimed", characterId: ezren });

    const res = await gmA.patch(`/api/characters/${amiri}`, { name: "Amiri", shares: 0 });
    expect(res.body.released).toBe(2);
    const loot = (await view()).loot;
    // The gems merge back into one available stack.
    expect(loot.filter((l) => l.name === "Gem")).toMatchObject([{ quantity: 3, status: "available" }]);
    expect(loot.find((l) => l.name === "Ring")).toMatchObject({ status: "available", characterId: null });
    expect(loot.find((l) => l.name === "Wand")).toMatchObject({ status: "claimed", characterId: ezren });
    // Saving again with shares changes nothing else.
    expect((await gmA.patch(`/api/characters/${ezren}`, { name: "Ezren", shares: 2 })).body.released).toBe(0);
  });

  test("a split needs at least one share", async () => {
    const { campaignId, sessionId, characterIds } = await seed();
    for (const [i, name] of ["Amiri", "Ezren", "Valeros"].entries()) {
      await gmA.patch(`/api/characters/${characterIds[i]}`, { name, shares: 0 });
    }
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Sword", value: 2000 });
    const res = await gmA.post(`/api/campaigns/${campaignId}/split`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("at least one character a share");
  });

  test("without debt allowed, nobody may end a split owing", async () => {
    const { campaignId, sessionId, characterIds, view } = await seed();
    const [amiri] = characterIds as [string];
    // 4 shares of 1200 is 300 each; Amiri's 800 ring leaves them 500 short.
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Sword", value: 800 });
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Ring", value: 1600, status: "claimed", characterId: amiri });
    const preview = (await gmA.get(`/api/campaigns/${campaignId}/split/preview`)).body;
    expect(preview.shares.find((s: any) => s.characterName === "Amiri").net).toBe(-500);

    const res = await gmA.post(`/api/campaigns/${campaignId}/split`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Amiri would end the split owing");
    const now = await view();
    expect(now.splits).toHaveLength(0);
    expect(now.loot.map((l) => l.status).sort()).toEqual(["available", "claimed"]);
  });

  test("with debt allowed, a shortfall carries forward until repaid", async () => {
    const { campaignId, sessionId, characterIds, view } = await seed();
    const [amiri] = characterIds as [string];
    const add = (body: object) => gmA.post(`/api/sessions/${sessionId}/loot`, body);
    const split = async () => (await gmA.post(`/api/campaigns/${campaignId}/split`)).body;
    const amiriNow = async () => (await view()).characters.find((c) => c.id === amiri)!;
    const setDebt = (allowDebt: boolean) =>
      gmA.patch(`/api/campaigns/${campaignId}`, { ...campaignBody, allowDebt });
    expect((await setDebt(true)).body.allowDebt).toBe(true);

    // 300 a share; Amiri's 800 ring leaves them owing 500.
    await add({ name: "Sword", value: 800 });
    await add({ name: "Ring", value: 1600, status: "claimed", characterId: amiri });
    const first = await split();
    expect(first.shares.find((s: any) => s.characterName === "Amiri")).toMatchObject({ debtIn: 0, net: -500 });
    expect(await amiriNow()).toMatchObject({ debt: 500, net: -500 });

    // Debt can't be turned off while it's owed.
    const off = await setDebt(false);
    expect(off.status).toBe(400);
    expect(off.body.fields.allowDebt).toBeDefined();

    // 300 a share again: it pays off part of the debt.
    await add({ name: "Statue", value: 2400 });
    const second = await split();
    expect(second.shares.find((s: any) => s.characterName === "Amiri")).toMatchObject({ debtIn: 500, net: -200 });
    expect((await amiriNow()).debt).toBe(200);

    // 500 a share clears it; the others are paid in full.
    await add({ name: "Vase", value: 4000 });
    expect((await amiriNow()).net).toBe(300);
    const third = await split();
    const byName = Object.fromEntries(third.shares.map((s: any) => [s.characterName, s]));
    expect(byName.Amiri).toMatchObject({ gross: 500, debtIn: 200, net: 300 });
    expect(byName.Ezren).toMatchObject({ gross: 500, debtIn: 0, net: 500 });
    expect(byName.Valeros).toMatchObject({ gross: 1000, net: 1000 });
    expect((await amiriNow()).debt).toBe(0);

    // Undoing each split puts the debt back as it was before it.
    const undo = (id: number) => gmA.del(`/api/campaigns/${campaignId}/splits/${id}`);
    await undo(third.id);
    expect((await amiriNow()).debt).toBe(200);
    await undo(second.id);
    expect((await amiriNow()).debt).toBe(500);
    await undo(first.id);
    expect((await amiriNow()).debt).toBe(0);
    expect((await setDebt(false)).status).toBe(200);
  });

  test("a character with no shares keeps their debt", async () => {
    const { campaignId, sessionId, characterIds, view } = await seed();
    const [amiri] = characterIds as [string];
    const add = (body: object) => gmA.post(`/api/sessions/${sessionId}/loot`, body);
    await gmA.patch(`/api/campaigns/${campaignId}`, { ...campaignBody, allowDebt: true });
    await add({ name: "Ring", value: 1600, status: "claimed", characterId: amiri });
    await gmA.post(`/api/campaigns/${campaignId}/split`);
    expect((await view()).characters.find((c) => c.id === amiri)!.debt).toBe(600);

    await gmA.patch(`/api/characters/${amiri}`, { name: "Amiri", shares: 0 });
    await add({ name: "Sword", value: 1200 });
    const res = (await gmA.post(`/api/campaigns/${campaignId}/split`)).body;
    expect(res.shares.map((s: any) => s.characterName).sort()).toEqual(["Ezren", "Valeros"]);
    expect((await view()).characters.find((c) => c.id === amiri)!.debt).toBe(600);
  });

  test("a partial update leaves other fields alone", async () => {
    const { sessionId } = await seed();
    const gem = (await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Gem", quantity: 4, value: 900, marketPct: 80 })).body;
    const res = await gmA.patch(`/api/loot/${gem.id}`, { status: "party" });
    expect(res.body).toMatchObject({ quantity: 4, value: 900, marketPct: 80, status: "party" });
  });

  test("links must be http or https web addresses", async () => {
    const { sessionId } = await seed();
    for (const link of ["javascript:alert(1)", "data:text/html,hi", "not a url"]) {
      const res = await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Map", link });
      expect(res.status).toBe(400);
      expect(res.body.fields.link).toBeDefined();
    }
    const map = (await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Map", link: " https://example.com/map " })).body;
    expect(map.link).toBe("https://example.com/map");
    expect((await gmA.patch(`/api/loot/${map.id}`, { link: "" })).body.link).toBeNull();
  });

  test("claimed loot needs a character from the campaign", async () => {
    const { sessionId } = await seed();
    const res = await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Ring", status: "claimed" });
    expect(res.status).toBe(400);
    expect(res.body.fields.characterId).toBeDefined();
  });
});

describe("petty cash", () => {
  test("a split tops petty cash up to its hold, and pays out anything above it", async () => {
    const { campaignId, sessionId, view } = await seed();
    const setHold = (pettyCashHold: number) =>
      gmA.patch(`/api/campaigns/${campaignId}`, { ...campaignBody, pettyCashHold });
    expect((await view()).campaign.pettyCashHold).toBe(0);
    expect((await setHold(-100)).body.fields.pettyCashHold).toBeDefined();
    // A whole number of gp only: 1.50 gp is refused.
    const part = await setHold(150);
    expect(part.status).toBe(400);
    expect(part.body.fields.pettyCashHold).toBe("Petty cash hold must be a whole number.");
    expect((await setHold(100)).body.pettyCashHold).toBe(100);

    // 1003 of loot gives up 100 to the hold; 903 over 4 shares is 225, 3 over.
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Statue", value: 2006 });
    expect((await view()).pool.pettyCashIn).toBe(-100);
    const preview = (await gmA.get(`/api/campaigns/${campaignId}/split/preview`)).body;
    expect(preview).toMatchObject({ total: 903, pettyCash: -100, leftover: 3 });
    const first = (await gmA.post(`/api/campaigns/${campaignId}/split`)).body;
    let now = await view();
    expect(now.campaign.pettyCash).toBe(103);
    expect(now.pettyCash).toMatchObject([{ amount: 103, splitId: first.id, description: "Loot split" }]);

    // With the hold dropped to 0, all 103 is paid out: 1103 is 275 a share
    // and 3 over, leaving 3.
    await setHold(0);
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Vase", value: 2000 });
    now = await view();
    expect(now.pool.pettyCashIn).toBe(103);
    expect(now.characters.map((c) => c.gross).sort()).toEqual([275, 275, 550]);
    await gmA.post(`/api/campaigns/${campaignId}/split`);
    now = await view();
    expect(now.campaign.pettyCash).toBe(3);
    expect(now.pettyCash.map((e) => e.amount)).toEqual([-100, 103]);
    expect(now.splits.map((s) => [s.total, s.pettyCash, s.leftover])).toEqual([
      [1103, 103, 3],
      [903, -100, 3],
    ]);
  });

  test("a hold larger than the loot takes all of it", async () => {
    const { campaignId, sessionId, view } = await seed();
    await gmA.patch(`/api/campaigns/${campaignId}`, { ...campaignBody, pettyCashHold: 5000 });
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Gem", value: 200 });
    const split = (await gmA.post(`/api/campaigns/${campaignId}/split`)).body;
    expect(split).toMatchObject({ total: 0, pettyCash: -100, leftover: 0 });
    expect(split.shares.every((sh: any) => sh.net === 0)).toBe(true);
    expect((await view()).campaign.pettyCash).toBe(100);
  });

  test("the GM records adjustments, which can't overdraw petty cash", async () => {
    const { campaignId, characterIds, view } = await seed();
    const entries = `/api/campaigns/${campaignId}/petty-cash`;
    const entry = (amount: number, description = "Job pay") =>
      gmA.post(entries, { date: "2026-02-01", description, amount });

    const paidIn = (await entry(500)).body;
    expect((await view()).campaign.pettyCash).toBe(500);
    const over = await entry(-700, "Inn");
    expect(over.status).toBe(400);
    expect(over.body.error).toContain("only holds 5.00 gp");
    expect(over.body.fields.amount).toBeDefined();
    const inn = (await entry(-200, "Inn")).body;
    expect((await view()).campaign.pettyCash).toBe(300);

    expect((await entry(0)).body.fields.amount).toBeDefined();
    expect((await gmA.post(entries, { date: "2026-02-01", description: "", amount: 1 })).body.fields.description).toBeDefined();

    // Editing moves the balance by the difference.
    expect((await gmA.patch(`/api/petty-cash/${paidIn.id}`, { date: "2026-02-01", description: "Job pay", amount: 100 })).status).toBe(400);
    expect((await gmA.patch(`/api/petty-cash/${paidIn.id}`, { date: "2026-02-02", description: "Bounty", amount: 300 })).status).toBe(200);
    let now = await view();
    expect(now.campaign.pettyCash).toBe(100);
    expect(now.pettyCash.map((e) => [e.date, e.description, e.amount])).toEqual([
      ["2026-02-02", "Bounty", 300],
      ["2026-02-01", "Inn", -200],
    ]);
    expect((await gmA.del(`/api/petty-cash/${paidIn.id}`)).status).toBe(400);
    expect((await gmA.del(`/api/petty-cash/${inn.id}`)).status).toBe(200);
    expect((await view()).campaign.pettyCash).toBe(300);

    // Players see the ledger but can't change it; nor can another GM.
    const code = (await view()).characters.find((c) => c.id === characterIds[0])!.joinCode!;
    const { player } = await join(code);
    const play = (await player.get<PlayView>(`/api/play/${characterIds[0]}`)).body;
    expect(play.pettyCash.map((e) => e.amount)).toEqual([300]);
    expect((await player.post(entries, { date: "2026-02-01", description: "x", amount: 1 })).status).toBe(401);
    const gmB = new Client(ctx.app);
    await gmB.login("bob@example.com");
    expect((await gmB.post(entries, { date: "2026-02-01", description: "x", amount: 1 })).status).toBe(404);
    expect((await gmB.del(`/api/petty-cash/${paidIn.id}`)).status).toBe(404);
    now = await view();
    expect(now.campaign.pettyCash).toBe(300);
  });

  test("a split's entry can only be removed by undoing the split", async () => {
    const { campaignId, sessionId, view } = await seed();
    await gmA.patch(`/api/campaigns/${campaignId}`, { ...campaignBody, pettyCashHold: 100 });
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Statue", value: 2006 });
    const split = (await gmA.post(`/api/campaigns/${campaignId}/split`)).body;
    const [splitEntry] = (await view()).pettyCash;
    const body = { date: "2026-02-01", description: "x", amount: 1 };
    expect((await gmA.patch(`/api/petty-cash/${splitEntry!.id}`, body)).status).toBe(400);
    expect((await gmA.del(`/api/petty-cash/${splitEntry!.id}`)).status).toBe(400);

    // Spending what the split put in blocks undoing it until it's paid back.
    const entries = `/api/campaigns/${campaignId}/petty-cash`;
    await gmA.post(entries, { date: "2026-02-01", description: "Potions", amount: -103 });
    const undo = () => gmA.del(`/api/campaigns/${campaignId}/splits/${split.id}`);
    const refused = await undo();
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain("can't be undone");
    await gmA.post(entries, { date: "2026-02-02", description: "Refund", amount: 103 });
    expect((await undo()).status).toBe(200);
    const now = await view();
    expect(now.campaign.pettyCash).toBe(0);
    expect(now.pettyCash.map((e) => e.description)).toEqual(["Refund", "Potions"]);
  });

  test("decimals lock once petty cash has been recorded", async () => {
    const { campaignId } = await seed();
    const entries = `/api/campaigns/${campaignId}/petty-cash`;
    await gmA.post(entries, { date: "2026-02-01", description: "In", amount: 5 });
    await gmA.post(entries, { date: "2026-02-01", description: "Out", amount: -5 });
    const res = await gmA.patch(`/api/campaigns/${campaignId}`, { ...campaignBody, currencyDecimals: 0 });
    expect(res.status).toBe(400);
    expect(res.body.fields.currencyDecimals).toBeDefined();
  });
});

describe("uploads", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  async function upload(campaignId: string, bytes: Uint8Array<ArrayBuffer>, type: string) {
    const form = new FormData();
    form.append("image", new File([bytes], "bg", { type }));
    return gmA.raw("PUT", `/api/campaigns/${campaignId}/image`, { body: form });
  }

  test("accepts a real image and serves it", async () => {
    const { campaignId } = await seed();
    const res = await upload(campaignId, png, "image/png");
    expect(res.status).toBe(200);
    const { backgroundImage } = (await res.json()) as { backgroundImage: string };
    const served = await gmA.raw("GET", `/uploads/${backgroundImage}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
  });

  test("rejects files that aren't images, whatever they claim", async () => {
    const { campaignId } = await seed();
    const res = await upload(campaignId, new TextEncoder().encode("<script>"), "image/png");
    expect(res.status).toBe(400);
  });

  test("rejects images over 5 MB", async () => {
    const { campaignId } = await seed();
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(png);
    expect((await upload(campaignId, big, "image/png")).status).toBe(400);
  });

  test("refuses path tricks", async () => {
    expect((await gmA.raw("GET", "/uploads/..%2Fapp.db")).status).toBe(404);
  });
});

describe("reference search", () => {
  const hit = (source: Record<string, unknown>) => ({ _source: source });

  test("only searches known reference sites", async () => {
    const { campaignId } = await seed();
    expect((await gmA.get(`/api/campaigns/${campaignId}/reference?q=potion`)).body).toEqual([]);
    await gmA.patch(`/api/campaigns/${campaignId}`, { ...campaignBody, baseReferenceUrl: "https://example.com/" });
    expect((await gmA.get(`/api/campaigns/${campaignId}/reference?q=potion`)).body).toEqual([]);
    expect(referenceCalls).toEqual([]);
  });

  test("returns matches with links and prices in the campaign's currency", async () => {
    const { campaignId } = await seed();
    await gmA.patch(`/api/campaigns/${campaignId}`, { ...campaignBody, baseReferenceUrl: "https://2e.aonprd.com/" });
    setReferenceReply(() =>
      Response.json({
        hits: {
          hits: [
            hit({ name: "Healing Potion (Minor)", url: "/Equipment.aspx?ID=2943", level: 1, price: 400, price_raw: "4 gp" }),
            hit({ name: "Healing Potion", url: "/Equipment.aspx?ID=2943", level: 1 }),
            hit({ name: "Elsewhere", url: "https://evil.example/x", price: 1 }),
            { nonsense: true },
          ],
        },
      }),
    );
    const res = await gmA.get(`/api/campaigns/${campaignId}/reference?q=healing%20potion`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        name: "Healing Potion (Minor)",
        url: "https://2e.aonprd.com/Equipment.aspx?ID=2943",
        level: 1,
        priceLabel: "4 gp",
        value: 400,
      },
      {
        name: "Healing Potion",
        url: "https://2e.aonprd.com/Equipment.aspx?ID=2943",
        level: 1,
        priceLabel: null,
        value: null,
      },
    ]);
    expect(referenceCalls).toHaveLength(1);
    expect(referenceCalls[0]!.url).toBe("https://elasticsearch.aonprd.com/aon/_search");
    expect(referenceCalls[0]!.body.size).toBe(10);
  });

  test("leaves the value out when the currency doesn't match", async () => {
    const { campaignId } = await seed();
    await gmA.patch(`/api/campaigns/${campaignId}`, {
      ...campaignBody,
      currencyLabel: "cr",
      baseReferenceUrl: "https://2e.aonprd.com/",
    });
    setReferenceReply(() => Response.json({ hits: { hits: [hit({ name: "Rope", url: "/x", price: 5 })] } }));
    const res = await gmA.get(`/api/campaigns/${campaignId}/reference?q=rope`);
    expect(res.body[0].value).toBeNull();
  });

  test("ignores short queries and reports an unreachable site kindly", async () => {
    const { campaignId } = await seed();
    await gmA.patch(`/api/campaigns/${campaignId}`, { ...campaignBody, baseReferenceUrl: "https://2e.aonsrd.com/" });
    expect((await gmA.get(`/api/campaigns/${campaignId}/reference?q=a`)).body).toEqual([]);
    expect(referenceCalls).toEqual([]);
    setReferenceReply(() => new Response("down", { status: 503 }));
    const res = await gmA.get(`/api/campaigns/${campaignId}/reference?q=laser`);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("The reference site couldn't be searched just now.");
    expect(referenceCalls[0]!.url).toBe("https://elasticsearch.aonprd.com/aonsf/_search");
  });

  test("is only available to the campaign's GM", async () => {
    const { campaignId } = await seed();
    const gmB = new Client(ctx.app, "10.0.0.2");
    await gmB.login("bob@example.com");
    expect((await gmB.get(`/api/campaigns/${campaignId}/reference?q=rope`)).status).toBe(404);
  });
});

describe("live updates", () => {
  const decoder = new TextDecoder();

  /**
   * Opens an event stream; `next` resolves with the next "changed" origin,
   * and `nextEvent` with the whole event.
   */
  async function openStream(client: Client, path: string) {
    const abort = new AbortController();
    const res = await client.raw("GET", path, { signal: abort.signal });
    const reader = res.body?.getReader();
    let buf = "";
    async function nextEvent(): Promise<{ origin: string | null; notices: LiveNotice[] }> {
      for (;;) {
        const end = buf.indexOf("\n\n");
        if (end >= 0) {
          const block = buf.slice(0, end);
          buf = buf.slice(end + 2);
          if (!block.startsWith("event: changed")) continue;
          return JSON.parse(block.split("\ndata: ")[1]!);
        }
        const { value, done } = await reader!.read();
        if (done) throw new Error("stream ended");
        buf += decoder.decode(value);
      }
    }
    const timeout = () =>
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no event")), 1000));
    return {
      res,
      next: () => Promise.race([nextEvent().then((e) => e.origin), timeout()]),
      nextEvent: () => Promise.race([nextEvent(), timeout()]),
      close: () => abort.abort(),
    };
  }

  /** Counts the times a campaign is announced as changed. */
  function watch(campaignId: string) {
    const seen = { count: 0 };
    ctx.app.events.subscribe(campaignId, () => seen.count++);
    return seen;
  }

  test("the GM's stream hears a player's claim, with the claimant's tab id", async () => {
    const { campaignId, sessionId, view } = await seed();
    const potion = (await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Potion", quantity: 3 })).body;
    const code = (await view()).characters[0]!.joinCode!;
    const { player, res } = await join(code);
    const stream = await openStream(gmA, `/api/campaigns/${campaignId}/events`);
    expect(stream.res.status).toBe(200);
    expect(stream.res.headers.get("content-type")).toBe("text/event-stream");
    await player.raw("POST", `/api/play/${res.body.characterId}/claim`, {
      headers: { "content-type": "application/json", "x-client-id": "tab-1" },
      body: JSON.stringify({ lootId: potion.id, quantity: 1 }),
    });
    expect(await stream.next()).toBe("tab-1");
    stream.close();
  });

  test("claims and releases carry a notice for other tabs", async () => {
    const { campaignId, sessionId, view } = await seed();
    const potion = (await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Potion", quantity: 3 })).body;
    const first = (await view()).characters[0]!;
    const { player, res } = await join(first.joinCode!);
    const playerStream = await openStream(player, `/api/play/${res.body.characterId}/events`);
    const gmStream = await openStream(gmA, `/api/campaigns/${campaignId}/events`);
    const claimed = await player.post(`/api/play/${res.body.characterId}/claim`, {
      lootId: potion.id,
      quantity: 2,
    });
    const claimNotice: LiveNotice = {
      kind: "claimed",
      byGm: false,
      character: first.name,
      item: "Potion",
      quantity: 2,
    };
    expect((await gmStream.nextEvent()).notices).toEqual([claimNotice]);
    expect((await playerStream.nextEvent()).notices).toEqual([claimNotice]);
    await gmA.post(`/api/loot/${claimed.body.id}/release`);
    expect((await playerStream.nextEvent()).notices).toEqual([
      { ...claimNotice, kind: "released", byGm: true },
    ]);
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Rope" });
    expect((await playerStream.nextEvent()).notices).toEqual([]);
    gmStream.close();
    playerStream.close();
  });

  test("a player's stream hears the GM's edits", async () => {
    const { sessionId, view } = await seed();
    const { player, res } = await join((await view()).characters[0]!.joinCode!);
    const stream = await openStream(player, `/api/play/${res.body.characterId}/events`);
    expect(stream.res.status).toBe(200);
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Rope" });
    expect(await stream.next()).toBeNull();
    stream.close();
  });

  test("closing a stream unsubscribes it", async () => {
    const { campaignId } = await seed();
    const stream = await openStream(gmA, `/api/campaigns/${campaignId}/events`);
    expect(ctx.app.events.count(campaignId)).toBe(1);
    stream.close();
    expect(ctx.app.events.count(campaignId)).toBe(0);
  });

  test("streams need access to the campaign", async () => {
    const { campaignId, characterIds } = await seed();
    const gmB = new Client(ctx.app, "10.0.0.2");
    await gmB.login("bob@example.com");
    expect((await gmB.raw("GET", `/api/campaigns/${campaignId}/events`)).status).toBe(404);
    const stranger = new Client(ctx.app, "10.0.0.3");
    expect((await stranger.raw("GET", `/api/play/${characterIds[0]}/events`)).status).toBe(401);
    expect(ctx.app.events.count(campaignId)).toBe(0);
  });

  test("the GM sees which characters' players have them open", async () => {
    const { campaignId, view } = await seed();
    const first = (await view()).characters[0]!;
    const { player, res } = await join(first.joinCode!);
    const online = async () => (await view()).characters.find((c) => c.id === first.id)!.online;
    expect(await online()).toBe(false);

    const gmStream = await openStream(gmA, `/api/campaigns/${campaignId}/events`);
    const playerStream = await openStream(player, `/api/play/${res.body.characterId}/events`);
    expect(await gmStream.next()).toBeNull();
    expect(await online()).toBe(true);
    // A second tab for the same character keeps it online when one closes.
    const second = await openStream(player, `/api/play/${res.body.characterId}/events`);
    second.close();
    expect(await online()).toBe(true);
    playerStream.close();
    expect(await gmStream.next()).toBeNull();
    expect(await online()).toBe(false);
    gmStream.close();
  });

  test("only GM streams hear who is online", async () => {
    const { campaignId, view } = await seed();
    const [a, b] = (await view()).characters as [CharacterView, CharacterView];
    const watcher = await join(a.joinCode!);
    const other = await join(b.joinCode!, "10.0.0.9");
    const watching = await openStream(watcher.player, `/api/play/${a.id}/events`);
    const stream = await openStream(other.player, `/api/play/${b.id}/events`);
    await expect(watching.next()).rejects.toThrow("no event");
    const played = (await other.player.get(`/api/play/${b.id}`)).body as PlayView;
    expect(played.characters.every((c) => c.online === undefined)).toBe(true);
    stream.close();
    watching.close();
  });

  test("a signed-out player's open stream doesn't count", async () => {
    const { view } = await seed();
    const first = (await view()).characters[0]!;
    const { player } = await join(first.joinCode!);
    const stream = await openStream(player, `/api/play/${first.id}/events`);
    await gmA.post(`/api/characters/${first.id}/code`);
    expect((await view()).characters[0]!.online).toBe(false);
    stream.close();
  });

  test("a rejected change announces nothing", async () => {
    const { campaignId, sessionId } = await seed();
    const seen = watch(campaignId);
    expect((await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "" })).status).toBe(400);
    expect(seen.count).toBe(0);
  });

  test("every change to a campaign is announced", async () => {
    const { campaignId, characterIds, sessionId, view } = await seed();
    const seen = watch(campaignId);
    const expectAnnounced = async <T extends { status: number }>(pending: Promise<T>) => {
      const before = seen.count;
      const res = await pending;
      expect(res.status).toBeLessThan(400);
      expect(seen.count).toBe(before + 1);
      return res;
    };
    const [amiri, ezren] = characterIds as [string, string];
    await expectAnnounced(gmA.patch(`/api/campaigns/${campaignId}`, { ...campaignBody, name: "Renamed" }));
    await expectAnnounced(gmA.post(`/api/campaigns/${campaignId}/characters`, { name: "Seoni", shares: 1 }));
    await expectAnnounced(gmA.patch(`/api/characters/${ezren}`, { name: "Ezren", shares: 2 }));
    await expectAnnounced(gmA.post(`/api/characters/${ezren}/code`));
    const s = (await gmA.post(`/api/campaigns/${campaignId}/sessions`, { date: "2026-02-01" })).body;
    await expectAnnounced(gmA.patch(`/api/sessions/${s.id}`, { date: "2026-02-02" }));
    await expectAnnounced(gmA.del(`/api/sessions/${s.id}`));
    const rope = (await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Rope", value: 100 })).body;
    await expectAnnounced(gmA.patch(`/api/loot/${rope.id}`, { name: "Silk rope" }));
    await expectAnnounced(gmA.post(`/api/loot/${rope.id}/claim`, { characterId: amiri, quantity: 1 }));
    await expectAnnounced(gmA.post(`/api/loot/${rope.id}/release`));
    const gem = (await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Gem", value: 500 })).body;
    const code = (await view()).characters.find((c) => c.id === amiri)!.joinCode!;
    const player = new Client(ctx.app, "10.0.0.9");
    await expectAnnounced(player.post("/api/join", { code }));
    await expectAnnounced(player.post(`/api/play/${amiri}/claim`, { lootId: gem.id, quantity: 1 }));
    await expectAnnounced(player.post(`/api/play/${amiri}/release`, { lootId: gem.id }));
    await expectAnnounced(gmA.del(`/api/loot/${gem.id}`));
    const split = (await expectAnnounced(gmA.post(`/api/campaigns/${campaignId}/split`))).body;
    await expectAnnounced(gmA.del(`/api/campaigns/${campaignId}/splits/${split.id}`));
    await expectAnnounced(gmA.post(`/api/campaigns/${campaignId}/split`));
    await expectAnnounced(player.del(`/api/play/${amiri}`));
    const merisiel = (await gmA.post(`/api/campaigns/${campaignId}/characters`, { name: "Merisiel", shares: 1 })).body;
    await expectAnnounced(gmA.del(`/api/characters/${merisiel.id}`));
    await expectAnnounced(gmA.del(`/api/campaigns/${campaignId}/image`));
    await expectAnnounced(gmA.del(`/api/campaigns/${campaignId}`));
  });
});
