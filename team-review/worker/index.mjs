import assets from "../generated/assets.mjs";
import { api, HttpError } from "./api.mjs";
export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/") || path.startsWith("/media/")) {
      try {
        return await api(request, env, ctx);
      } catch (error) {
        if (!(error instanceof HttpError))
          console.error("API failure", error.message);
        return Response.json(
          {
            error:
              error instanceof HttpError
                ? error.message
                : "The service is temporarily unavailable. Please retry.",
          },
          {
            status: error.status || 503,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Not found", { status: 404 });
    const asset =
      assets[
        path === "/" || path === "/admin" || path === "/review"
          ? "/index.html"
          : path
      ];
    if (asset === undefined) return new Response("Not found", { status: 404 });
    const type = path.endsWith(".css")
      ? "text/css"
      : /\.(js|mjs)$/.test(path)
        ? "text/javascript"
        : /\.(py|md)$/.test(path)
          ? "text/plain"
          : "text/html";
    return new Response(request.method === "HEAD" ? null : asset, {
      headers: {
        "Content-Type": type + "; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
      },
    });
  },
};
