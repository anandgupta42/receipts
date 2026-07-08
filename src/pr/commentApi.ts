// SPEC-0064 R3 — GitHub REST upsert for the npm-native `pr-check` command.
// This is deliberately separate from `comment.ts`, which shells out to `gh`;
// CI has only `GITHUB_TOKEN`, and tests inject this fetch-like seam.
import { DOGFOOD_MARKER } from "./body.js";

export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type HttpFetch = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;

export const globalHttpFetch: HttpFetch = async (url, init) => {
  const response = await fetch(url, init);
  return {
    status: response.status,
    json: () => response.json() as Promise<unknown>,
    text: () => response.text(),
  };
};

export interface MarkerComment {
  id: number;
}

export type UpsertMarkerOutcome =
  | { ok: true; action: "created" | "updated" }
  | { ok: false; reason: string; readOnly?: boolean };

interface FindMarkerResult {
  ok: boolean;
  comment?: MarkerComment | null;
  status?: number;
  reason?: string;
}

const PER_PAGE = 100;

function headers(token: string, withJson = false): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "aireceipts",
    ...(withJson ? { "Content-Type": "application/json" } : {}),
  };
}

function commentsUrl(baseRepo: string, pr: string | number, page: number): string {
  return `https://api.github.com/repos/${baseRepo}/issues/${pr}/comments?per_page=${PER_PAGE}&page=${page}`;
}

function commentUrl(baseRepo: string, id: number): string {
  return `https://api.github.com/repos/${baseRepo}/issues/comments/${id}`;
}

function createUrl(baseRepo: string, pr: string | number): string {
  return `https://api.github.com/repos/${baseRepo}/issues/${pr}/comments`;
}

function markerFromPage(page: unknown[]): MarkerComment | null {
  for (const item of page) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    const comment = item as { id?: unknown; body?: unknown };
    if (typeof comment.id === "number" && typeof comment.body === "string" && comment.body.startsWith(DOGFOOD_MARKER)) {
      return { id: comment.id };
    }
  }
  return null;
}

async function reasonFrom(response: HttpResponse, action: string): Promise<string> {
  const detail = (await response.text()).trim();
  return detail ? `${action}: GitHub API returned ${response.status}: ${detail}` : `${action}: GitHub API returned ${response.status}`;
}

function failure(status: number, reason: string): UpsertMarkerOutcome {
  if (status === 403) {
    return { ok: false, readOnly: true, reason: "read-only token (fork PR)" };
  }
  if (status === 404) {
    return { ok: false, reason };
  }
  return { ok: false, reason };
}

async function findMarkerCommentResult(baseRepo: string, pr: string | number, token: string, http: HttpFetch): Promise<FindMarkerResult> {
  for (let page = 1; ; page += 1) {
    const response = await http(commentsUrl(baseRepo, pr, page), {
      method: "GET",
      headers: headers(token),
    });
    if (response.status !== 200) {
      return { ok: false, status: response.status, reason: await reasonFrom(response, "list PR comments") };
    }
    const parsed = await response.json();
    if (!Array.isArray(parsed)) {
      return { ok: false, status: response.status, reason: "list PR comments: response was not an array" };
    }
    const marker = markerFromPage(parsed);
    if (marker) {
      return { ok: true, comment: marker };
    }
    if (parsed.length < PER_PAGE) {
      return { ok: true, comment: null };
    }
  }
}

export async function findMarkerComment(
  baseRepo: string,
  pr: string | number,
  token: string,
  http: HttpFetch = globalHttpFetch,
): Promise<MarkerComment | null> {
  const result = await findMarkerCommentResult(baseRepo, pr, token, http);
  return result.ok ? (result.comment ?? null) : null;
}

export async function upsertMarkerComment(
  args: { baseRepo: string; pr: string | number; token: string; body: string },
  http: HttpFetch = globalHttpFetch,
): Promise<UpsertMarkerOutcome> {
  const existing = await findMarkerCommentResult(args.baseRepo, args.pr, args.token, http);
  if (!existing.ok) {
    return failure(existing.status ?? 0, existing.reason ?? "could not list PR comments");
  }

  const payload = JSON.stringify({ body: args.body });
  if (existing.comment) {
    const response = await http(commentUrl(args.baseRepo, existing.comment.id), {
      method: "PATCH",
      headers: headers(args.token, true),
      body: payload,
    });
    if (response.status === 200) {
      return { ok: true, action: "updated" };
    }
    return failure(response.status, await reasonFrom(response, "update PR comment"));
  }

  const response = await http(createUrl(args.baseRepo, args.pr), {
    method: "POST",
    headers: headers(args.token, true),
    body: payload,
  });
  if (response.status === 201) {
    return { ok: true, action: "created" };
  }
  return failure(response.status, await reasonFrom(response, "create PR comment"));
}
