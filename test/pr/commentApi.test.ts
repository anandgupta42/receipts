import { describe, expect, it } from "vitest";
import { DOGFOOD_MARKER } from "../../src/pr/body.js";
import { findMarkerComment, type HttpFetch, type HttpRequestInit, type HttpResponse, upsertMarkerComment } from "../../src/pr/commentApi.js";

interface HttpCall {
  url: string;
  init?: HttpRequestInit;
}

function response(status: number, jsonValue: unknown, textValue = ""): HttpResponse {
  return {
    status,
    json: async () => jsonValue,
    text: async () => textValue,
  };
}

function mockHttp(responses: HttpResponse[]): { http: HttpFetch; calls: HttpCall[] } {
  const calls: HttpCall[] = [];
  const http: HttpFetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) {
      throw new Error(`unexpected request: ${url}`);
    }
    return next;
  };
  return { http, calls };
}

describe("SPEC-0064 commentApi", () => {
  it("creates a marker comment when none exists", async () => {
    const { http, calls } = mockHttp([response(200, []), response(201, { id: 7 })]);
    const out = await upsertMarkerComment({ baseRepo: "owner/repo", pr: "12", token: "tok", body: `${DOGFOOD_MARKER}\nbody` }, http);

    expect(out).toEqual({ ok: true, action: "created" });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://api.github.com/repos/owner/repo/issues/12/comments?per_page=100&page=1");
    expect(calls[1].url).toBe("https://api.github.com/repos/owner/repo/issues/12/comments");
    expect(calls[1].init?.method).toBe("POST");
    expect(calls[1].init?.body).toBe(JSON.stringify({ body: `${DOGFOOD_MARKER}\nbody` }));
  });

  it("paginates to find and update the existing marker comment", async () => {
    const firstPage = Array.from({ length: 100 }, (_, id) => ({ id, body: "not a receipt" }));
    const { http, calls } = mockHttp([response(200, firstPage), response(200, [{ id: 42, body: `${DOGFOOD_MARKER}\nold` }]), response(200, { id: 42 })]);

    const out = await upsertMarkerComment({ baseRepo: "owner/repo", pr: 3, token: "tok", body: `${DOGFOOD_MARKER}\nnew` }, http);

    expect(out).toEqual({ ok: true, action: "updated" });
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/repos/owner/repo/issues/3/comments?per_page=100&page=1",
      "https://api.github.com/repos/owner/repo/issues/3/comments?per_page=100&page=2",
      "https://api.github.com/repos/owner/repo/issues/comments/42",
    ]);
    expect(calls[2].init?.method).toBe("PATCH");
  });

  it("classifies a 403 as a read-only fork token", async () => {
    const { http } = mockHttp([response(200, []), response(403, {}, "forbidden")]);

    const out = await upsertMarkerComment({ baseRepo: "owner/repo", pr: 3, token: "tok", body: `${DOGFOOD_MARKER}\nbody` }, http);

    expect(out).toEqual({ ok: false, readOnly: true, reason: "read-only token (fork PR)" });
  });

  it("classifies a 404 without throwing", async () => {
    const { http } = mockHttp([response(404, {}, "not found")]);

    const out = await upsertMarkerComment({ baseRepo: "owner/repo", pr: 3, token: "tok", body: `${DOGFOOD_MARKER}\nbody` }, http);

    expect(out.ok).toBe(false);
    expect(out).not.toHaveProperty("readOnly");
    if (!out.ok) {
      expect(out.reason).toContain("404");
    }
  });

  it("findMarkerComment follows pages and returns the first marked id", async () => {
    const firstPage = Array.from({ length: 100 }, (_, id) => ({ id, body: "not a receipt" }));
    const { http, calls } = mockHttp([response(200, firstPage), response(200, [{ id: 99, body: `${DOGFOOD_MARKER}\nold` }])]);

    await expect(findMarkerComment("owner/repo", 4, "tok", http)).resolves.toEqual({ id: 99 });
    expect(calls).toHaveLength(2);
  });
});
