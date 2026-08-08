export function httpGet(url) { return http_get(url); }
export function httpPost(url, body, contentType = "application/json") {
    return http_post(url, body, contentType);
}
export function pollHttp(id) { return http_poll(id); }
