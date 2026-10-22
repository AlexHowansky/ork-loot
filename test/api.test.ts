import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { addGm, Client, makeApp } from "./helpers.ts";
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
  const ids: number[] = [];
  for (const [name, shares] of [["Amiri", 1], ["Ezren", 1], ["Valeros", 2]] as const) {
    ids.push((await gmA.post(`/api/campaigns/${c.id}/characters`, { name, shares })).body.id);
  }
  const s = (await gmA.post(`/api/campaigns/${c.id}/sessions`, { date: "2026-01-05" })).body;
  const view = async () => (await gmA.get<CampaignView>(`/api/campaigns/${c.id}`)).body;
  return { campaignId: c.id as number, characterIds: ids, sessionId: s.id as number, view };
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

  test("validates input with field messages", async () => {
    const res = await gmA.post("/api/campaigns", { ...campaignBody, name: "", startDate: "x" });
    expect(res.status).toBe(400);
    expect(res.body.fields.name).toBe("Name is required.");
    expect(res.body.fields.startDate).toBeDefined();
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
    const second = await join(fresh);
    expect(second.res.status).toBe(200);
    // The new player now owns the character; the old browser lost it.
    expect((await first.player.get(`/api/play/${characterIds[0]}`)).status).toBe(404);
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
      amiri: { client: amiri.player, id: amiri.res.body.characterId as number },
      ezren: { client: ezren.player, id: ezren.res.body.characterId as number },
    };
  }

  test("claiming part of a stack splits the row", async () => {
    const { potion, amiri, view } = await withPotions();
    const res = await amiri.client.post(`/api/play/${amiri.id}/claim`, { lootId: potion.id, quantity: 2 });
    expect(res.status).toBe(200);
    const loot = (await view()).loot;
    expect(loot.find((l) => l.status === "active")!.quantity).toBe(3);
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
    expect(loot[0]!.status).toBe("active");
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
    await add({ name: "Junk", value: 100, status: "left" });
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
    expect(status("Junk")).toBe("left");
    expect(after.loot.find((l) => l.id === ring.id)!.status).toBe("bought");
    expect(after.pool.sellable).toBe(0);
    expect(after.splits).toHaveLength(1);

    // Nothing left to split.
    expect((await gmA.post(`/api/campaigns/${campaignId}/split`)).status).toBe(400);
  });

  test("leftovers go to petty cash only when a split runs", async () => {
    const { campaignId, sessionId, view } = await seed();
    // 4 shares; a subtotal of 1003 leaves 3 over, then 1001 leaves 1 more.
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Statue", value: 2006 });

    const preview = (await gmA.get(`/api/campaigns/${campaignId}/split/preview`)).body;
    expect(preview.leftover).toBe(3);
    expect(preview.shares.map((s: any) => s.gross).sort()).toEqual([250, 250, 500]);
    expect((await view()).campaign.pettyCash).toBe(0);

    const first = (await gmA.post(`/api/campaigns/${campaignId}/split`)).body;
    expect(first.leftover).toBe(3);
    expect((await view()).campaign.pettyCash).toBe(3);

    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Vase", value: 2002 });
    await gmA.post(`/api/campaigns/${campaignId}/split`);
    const after = await view();
    expect(after.campaign.pettyCash).toBe(4);
    expect(after.splits.map((s) => s.leftover)).toEqual([1, 3]);
  });

  test("characters with split history can't be deleted", async () => {
    const { campaignId, sessionId, characterIds } = await seed();
    await gmA.post(`/api/sessions/${sessionId}/loot`, { name: "Sword", value: 2000 });
    await gmA.post(`/api/campaigns/${campaignId}/split`);
    expect((await gmA.del(`/api/characters/${characterIds[0]}`)).status).toBe(409);
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

  async function upload(campaignId: number, bytes: Uint8Array<ArrayBuffer>, type: string) {
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
