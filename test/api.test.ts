import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { addGm, Client, makeApp, referenceCalls, setReferenceReply } from "./helpers.ts";
import { campaign } from "../src/server/db/schema.ts";
import type { CampaignView, PlayView } from "../src/shared/types.ts";

let ctx: ReturnType<typeof makeApp>;
let gmA: Client;

beforeEach(async () => {
  ctx = makeApp();
  await addGm(ctx.db, "alice");
  await addGm(ctx.db, "bob");
  gmA = new Client(ctx.app);
  expect((await gmA.login("alice")).status).toBe(200);
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
    const res = await new Client(ctx.app).login("alice", "nope");
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("don't match");
  });

  test("unknown users get the same message", async () => {
    const res = await new Client(ctx.app).login("mallory", "nope");
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("don't match");
  });

  test("logout ends the session", async () => {
    await gmA.post("/api/auth/logout");
    expect((await gmA.get("/api/campaigns")).status).toBe(401);
  });

  test("rate limits login attempts", async () => {
    const c = new Client(ctx.app, "10.9.9.9");
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await c.login("alice", "wrong")).status;
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

describe("campaign access", () => {
  test("one GM can't see or change another GM's campaign", async () => {
    const { campaignId, characterIds, sessionId } = await seed();
    const gmB = new Client(ctx.app);
    await gmB.login("bob");
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
    await gmB.login("bob");
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
    expect(before.pool).toEqual({ sellable: 2000, party: 400, claimed: 400, totalShares: 4 });

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

  test("unidentified items are hidden from players and worth nothing", async () => {
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
      name: "Unidentified item",
      description: null,
      link: null,
      value: null,
      subtotal: 0,
      unidentified: true,
    });
    expect(JSON.stringify(play)).not.toContain("Fireballs");

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
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Ring", value: 800, status: "claimed", characterId: amiri });
    const s = (await gmA.post(`/api/campaigns/${campaignId}/split`)).body;
    const gmB = new Client(ctx.app);
    await gmB.login("bob");
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
    await gmB.login("bob");
    expect((await gmB.get(`/api/campaigns/${campaignId}/reference?q=rope`)).status).toBe(404);
  });
});
