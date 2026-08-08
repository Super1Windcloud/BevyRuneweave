export type HttpPollResult =
  | { state: "pending" }
  | { state: "complete"; status: number; body: string }
  | { state: "error"; error: string }
  | { state: "unknown" };

export function httpGet(url: string): number { return http_get(url); }
export function httpPost(
  url: string,
  body: string,
  contentType = "application/json",
): number {
  return http_post(url, body, contentType);
}
export function pollHttp(id: number): HttpPollResult { return http_poll(id); }
