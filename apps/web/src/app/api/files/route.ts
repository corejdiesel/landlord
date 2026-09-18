import { NextResponse } from "next/server";
import { LocalStorageAdapter, verifySignedPath } from "../../../adapters/storage/index";

/**
 * Serve an uploaded document from a signed URL.
 *
 * Signed rather than session-checked so a document can be embedded or handed to
 * a PDF renderer, and served with a strict content type and an attachment
 * disposition so an uploaded file can never execute in our origin.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  const expires = Number(url.searchParams.get("expires"));
  const sig = url.searchParams.get("sig");

  if (!path || !sig || !Number.isFinite(expires)) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!verifySignedPath(path, expires, sig)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const file = await new LocalStorageAdapter().get(path);
  if (!file.ok) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      // Never serve a user-uploaded file as anything the browser will execute.
      "content-type": "application/octet-stream",
      "content-disposition": "attachment",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
