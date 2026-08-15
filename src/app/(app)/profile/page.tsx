"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_ROLE_LABELS, type AppRole } from "@convex/lib/types";
import { initials } from "@convex/lib/format";
import {
  BadgeCheck,
  Camera,
  CheckCircle2,
  Loader2,
  MapPin,
  RefreshCcw,
  Save,
  Trash2,
  Upload,
  UserCircle,
  X,
} from "lucide-react";

export default function ProfilePage() {
  const profile = useQuery(api.profile.getMine);
  const generateUploadUrl = useMutation(api.profile.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.profile.setAvatar);
  const removeAvatar = useMutation(api.profile.removeAvatar);
  const updateName = useMutation(api.profile.updateName);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  // Camera capture state.
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => stopCamera(); // clean up on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      // Attach once the <video> renders.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch {
      setError(
        "Could not access the camera. Allow camera permission in the browser, or upload a photo instead.",
      );
    }
  }

  async function uploadBlob(blob: Blob, filename: string) {
    setBusy(true);
    setError(null);
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": blob.type || "image/jpeg" },
        body: blob,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: string };
      await setAvatar({ storageId: storageId as Id<"_storage"> });
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not save ${filename}.`);
    } finally {
      setBusy(false);
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    // Center-crop to a square for a clean avatar.
    const size = Math.min(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(
      video,
      (video.videoWidth - size) / 2,
      (video.videoHeight - size) / 2,
      size,
      size,
      0,
      0,
      512,
      512,
    );
    canvas.toBlob(
      async (blob) => {
        if (blob) {
          stopCamera();
          await uploadBlob(blob, "camera photo");
        }
      },
      "image/jpeg",
      0.92,
    );
  }

  if (profile === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (profile === null) return null;

  const displayName = profile.name ?? profile.email ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Profile"
        description="Your identity, designated role and profile photo. Take a photo with your camera or upload one."
      />

      <div className="stagger-children grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        {/* Photo card */}
        <Card className="card-lift sheen">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="icon-chip">
                <Camera className="h-4 w-4" />
              </span>
              Profile photo
            </CardTitle>
            <CardDescription>
              JPEG/PNG up to 6 MB. Stored securely in Convex.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            {cameraOn ? (
              <div className="relative overflow-hidden rounded-2xl border border-accent/40 shadow-[0_0_24px_hsl(var(--accent)/0.25)]">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-64 w-64 -scale-x-100 object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 bg-gradient-to-t from-black/70 to-transparent p-3">
                  <Button
                    size="sm"
                    variant="brand"
                    onClick={capturePhoto}
                    disabled={busy}
                  >
                    <Camera className="h-4 w-4" /> Capture
                  </Button>
                  <Button size="sm" variant="secondary" onClick={stopCamera}>
                    <X className="h-4 w-4" /> Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="glow-pulse relative h-40 w-40 overflow-hidden rounded-full border-2 border-accent/50 bg-accent/10">
                {profile.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.avatarUrl}
                    alt="Your profile photo"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-4xl font-bold text-accent">
                    {initials(displayName || "?")}
                  </div>
                )}
              </div>
            )}

            {!cameraOn && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant="accent"
                  size="sm"
                  className="hover-wiggle"
                  onClick={startCamera}
                  disabled={busy}
                >
                  <Camera className="h-4 w-4" /> Take photo
                </Button>
                <label className="inline-flex">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadBlob(f, f.name);
                      e.currentTarget.value = "";
                    }}
                  />
                  <span className="hover-wiggle inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted">
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    Upload
                  </span>
                </label>
                {profile.avatarUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeAvatar({})}
                    disabled={busy}
                  >
                    <Trash2 className="h-4 w-4" /> Remove
                  </Button>
                )}
              </div>
            )}
            {error && (
              <p className="text-center text-sm text-critical" role="alert">
                {error}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Identity card */}
        <Card className="card-lift sheen">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="icon-chip">
                <UserCircle className="h-4 w-4" />
              </span>
              Identity & designated role
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Display name
              </label>
              <div className="flex gap-2">
                <input
                  value={nameDraft ?? profile.name ?? ""}
                  onChange={(e) => {
                    setNameDraft(e.target.value);
                    setNameSaved(false);
                  }}
                  className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="Your name"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || nameDraft === null || nameDraft === profile.name}
                  onClick={async () => {
                    if (nameDraft === null) return;
                    await updateName({ name: nameDraft });
                    setNameSaved(true);
                  }}
                >
                  <Save className="h-4 w-4" /> Save
                </Button>
                {nameSaved && <CheckCircle2 className="mt-2 h-4 w-4 text-success" />}
              </div>
            </div>

            <Field label="Email">{profile.email ?? "—"}</Field>

            <div>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Application roles
              </div>
              <div className="flex flex-wrap gap-1.5">
                {profile.roles.length === 0 ? (
                  <Badge variant="warning">Awaiting access — no role granted yet</Badge>
                ) : (
                  profile.roles.map((r) => (
                    <Badge key={r} variant="info">
                      <BadgeCheck className="h-3 w-3" /> {APP_ROLE_LABELS[r as AppRole]}
                    </Badge>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Designated job role (roster)
              </div>
              {profile.employee ? (
                <div className="space-y-1 text-sm">
                  <div className="font-semibold">{profile.employee.displayName}</div>
                  <div className="flex items-center gap-1.5 text-accent">
                    <BadgeCheck className="h-4 w-4" /> {profile.employee.jobRole}
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />{" "}
                    {profile.employee.canonicalLocation} · {profile.employee.employeeId}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not linked to a roster employee yet — a System Admin can link your
                  account in Users &amp; Organization so your five KPIs appear here.
                </p>
              )}
            </div>

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCcw className="h-3 w-3" /> Changes apply instantly across the
              dashboard and are audit-logged.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
