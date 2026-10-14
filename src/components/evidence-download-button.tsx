"use client";

import { useState } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import type { Id } from "@convex/_generated/dataModel";
import { Download, Loader2 } from "lucide-react";
import { errorMessage } from "@/lib/errors";

/** Convex site URL (HTTP actions) derived from the deployment URL. */
const CONVEX_SITE_URL =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
  (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(".convex.cloud", ".convex.site");

/** Opens an evidence file through the authenticated, audited streaming route. */
export function EvidenceDownloadButton({
  evidenceId,
  label = "open",
  onOpened,
}: {
  evidenceId: Id<"evidenceFiles">;
  /** Visible text (default "open"). */
  label?: string;
  /** Called once the file was fetched and handed to the browser. */
  onOpened?: () => void;
}) {
  const token = useAuthToken();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function open() {
    if (!token || !CONVEX_SITE_URL) {
      setFailure("Not signed in yet — wait a moment and try again.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch(`${CONVEX_SITE_URL}/evidence?id=${evidenceId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(
          `${res.status === 403 ? "No access" : "Download failed"} (HTTP ${res.status})`,
        );
      }
      const filename =
        /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ??
        "evidence";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // Popup blockers often kill window.open after an await — fall back to a
      // same-page download link, which keeps the real filename too.
      const tab = window.open(url, "_blank", "noopener");
      if (!tab) {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      onOpened?.();
    } catch (err) {
      setFailure(
        err instanceof TypeError
          ? "Network/CORS error — check your connection and retry."
          : errorMessage(err, "Download failed."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      title={failure ? `${failure} Click to try again.` : "Open file (audited)"}
      className={`inline-flex items-center gap-1 text-xs hover:underline ${
        failure ? "text-critical" : "text-accent"
      }`}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      {failure ? "retry" : label}
    </button>
  );
}
