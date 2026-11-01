import "server-only";
import { timingSafeEqual } from "node:crypto";

// Each analysis costs money, so the app is locked behind one shared password
// (APP_PASSWORD), sent by the browser in the `x-app-password` header.
export function authorised(request: Request): boolean {
  const expected = process.env.APP_PASSWORD ?? "";
  const given = request.headers.get("x-app-password") ?? "";
  if (!expected || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
