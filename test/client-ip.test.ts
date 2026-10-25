import { describe, expect, test } from "bun:test";
import { clientIpOf } from "../src/server/lib/http.ts";

const SOCKET = "10.0.0.9";

function req(forwardedFor?: string) {
  const headers = new Headers();
  if (forwardedFor !== undefined) headers.set("x-forwarded-for", forwardedFor);
  return new Request("http://loot.test/", { headers });
}

describe("clientIpOf", () => {
  test("uses the socket address when no proxy is trusted", () => {
    expect(clientIpOf(req("203.0.113.1"), SOCKET, 0)).toBe(SOCKET);
  });

  test("takes the last entry behind one proxy", () => {
    expect(clientIpOf(req("198.51.100.7, 203.0.113.1"), SOCKET, 1)).toBe("203.0.113.1");
  });

  test("counts trusted proxies from the right", () => {
    expect(clientIpOf(req("198.51.100.7, 203.0.113.1, 10.0.0.2"), SOCKET, 2)).toBe(
      "203.0.113.1",
    );
  });

  test("reads IPv6 addresses", () => {
    expect(clientIpOf(req("2001:db8::1"), SOCKET, 1)).toBe("2001:db8::1");
  });

  test("falls back to the socket address when the header can't be used", () => {
    expect(clientIpOf(req(), SOCKET, 1)).toBe(SOCKET);
    expect(clientIpOf(req(""), SOCKET, 1)).toBe(SOCKET);
    expect(clientIpOf(req("203.0.113.1"), SOCKET, 2)).toBe(SOCKET);
    expect(clientIpOf(req("not-an-ip"), SOCKET, 1)).toBe(SOCKET);
  });
});
