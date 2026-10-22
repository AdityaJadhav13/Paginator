/** A recording fetch for the API client's tests: each call is kept, and answered from a queue or a route table. */
export interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
  readonly credentials: RequestCredentials | undefined;
  readonly cache: RequestCache | undefined;
  readonly keepalive: boolean | undefined;
}

export type Answer = Response | (() => Response | Promise<Response>) | Error;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function fakeFetch(route: (call: RecordedCall) => Answer) {
  const calls: RecordedCall[] = [];
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const call: RecordedCall = {
      url: String(input),
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : init.body,
      credentials: init.credentials,
      cache: init.cache,
      keepalive: init.keepalive,
    };
    calls.push(call);
    const answer = route(call);
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer() : answer;
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}
