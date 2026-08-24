import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginFileOpenerProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { AUDIO_EXTENSIONS, formatBytes, formatClock } from "./lib/formats";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type PreparedAudio = {
  url: string;
  fileName: string;
  mimeType: string;
  format: string;
  expiresAtMs: number;
  via: "preview" | "blob";
  sizeBytes?: number;
};

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function AudioPlayer({ path, source }: PluginFileOpenerProps) {
  const rpc = useRpc<typeof rpcContract>();
  const blobUrlRef = useRef<string | null>(null);
  const usedBlobRef = useRef(false);
  const [audio, setAudio] = useState<PreparedAudio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [duration, setDuration] = useState<number | null>(null);
  const sourceInput = {
    kind: source.kind,
    threadId: source.threadId,
    environmentId: source.environmentId,
    projectId: source.projectId,
  };

  const forgetBlob = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const loadBlob = useCallback(async () => {
    const result = await rpc.call("loadBytes", { path, source: sourceInput });
    forgetBlob();
    const bytes = base64ToBytes(result.contentBase64);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blobUrl = URL.createObjectURL(
      new Blob([copy], { type: result.mimeType }),
    );
    blobUrlRef.current = blobUrl;
    usedBlobRef.current = true;
    return {
      url: blobUrl,
      fileName: result.fileName,
      mimeType: result.mimeType,
      format: result.format,
      expiresAtMs: Date.now() + 24 * 60 * 60 * 1000,
      via: "blob" as const,
      sizeBytes: result.sizeBytes,
    };
  }, [
    forgetBlob,
    path,
    rpc,
    sourceInput.environmentId,
    sourceInput.kind,
    sourceInput.projectId,
    sourceInput.threadId,
  ]);

  const loadPreview = useCallback(async () => {
    const result = await rpc.call("prepare", { path, source: sourceInput });
    usedBlobRef.current = false;
    forgetBlob();
    return {
      url: result.url,
      fileName: result.fileName,
      mimeType: result.mimeType,
      format: result.format,
      expiresAtMs: result.expiresAtMs,
      via: "preview" as const,
    };
  }, [
    forgetBlob,
    path,
    rpc,
    sourceInput.environmentId,
    sourceInput.kind,
    sourceInput.projectId,
    sourceInput.threadId,
  ]);

  const load = useCallback(
    async (preferBlob = false) => {
      setLoading(true);
      setError(null);
      setDuration(null);
      try {
        setAudio(preferBlob ? await loadBlob() : await loadPreview());
      } catch (cause) {
        if (!preferBlob) {
          try {
            setAudio(await loadBlob());
            return;
          } catch (fallback) {
            setAudio(null);
            setError(
              fallback instanceof Error
                ? fallback.message
                : "Could not load this audio file.",
            );
            return;
          }
        }
        setAudio(null);
        setError(
          cause instanceof Error ? cause.message : "Could not load this audio file.",
        );
      } finally {
        setLoading(false);
      }
    },
    [loadBlob, loadPreview],
  );

  useEffect(() => {
    void load(false);
    return () => {
      forgetBlob();
    };
  }, [forgetBlob, load]);

  useEffect(() => {
    if (!audio || audio.via !== "preview") return;
    const remaining = audio.expiresAtMs - Date.now();
    if (remaining <= 0) {
      void load(false);
      return;
    }
    const timer = window.setTimeout(
      () => {
        void load(false);
      },
      Math.max(15_000, remaining - 60_000),
    );
    return () => window.clearTimeout(timer);
  }, [audio, load]);

  return (
    <div className="flex h-full min-h-0 items-center justify-center p-4 md:p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <div className="flex items-start gap-4">
            <div
              aria-hidden
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              <SpeakerMark />
            </div>
            <div className="min-w-0 space-y-1.5">
              <CardTitle className="truncate text-base">
                {audio?.fileName ?? fileNameHint(path)}
              </CardTitle>
              <CardDescription>
                {loading
                  ? "Loading audio…"
                  : [audio?.format, audio?.mimeType, durationLabel(duration, audio)]
                      .filter(Boolean)
                      .join(" · ")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button size="sm" variant="outline" onClick={() => void load(true)}>
                Retry
              </Button>
            </div>
          ) : loading && !audio ? (
            <div className="h-10 animate-pulse rounded-md bg-muted" />
          ) : audio ? (
            <audio
              key={audio.url}
              className="w-full"
              controls
              preload="metadata"
              onLoadedMetadata={(event) => {
                const next = event.currentTarget.duration;
                setDuration(Number.isFinite(next) ? next : null);
              }}
              onError={() => {
                if (!usedBlobRef.current) {
                  void load(true);
                  return;
                }
                setError(
                  `This browser could not decode ${audio.format} (${audio.mimeType}).`,
                );
              }}
            >
              <source src={audio.url} type={audio.mimeType} />
            </audio>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function durationLabel(duration: number | null, audio: PreparedAudio | null): string | null {
  if (duration != null) return formatClock(duration);
  if (audio?.sizeBytes != null) return formatBytes(audio.sizeBytes);
  return null;
}

function fileNameHint(path: string): string {
  const parts = path.split(/[/\\]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function SpeakerMark() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-6 w-6" fill="none">
      <path
        d="M5 9.2h2.8L12 6v12l-4.2-3.2H5A1.4 1.4 0 0 1 3.6 13.4v-2.8A1.4 1.4 0 0 1 5 9.2z"
        fill="currentColor"
      />
      <path
        d="M15.4 9c1.1.9 1.8 2.1 1.8 3.5s-.7 2.6-1.8 3.5M17.8 6.8c2 1.5 3.2 3.6 3.2 5.7s-1.2 4.2-3.2 5.7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default definePluginApp((app) => {
  app.slots.fileOpener({
    id: "audio-player",
    title: "Audio preview",
    extensions: AUDIO_EXTENSIONS,
    component: AudioPlayer,
  });
});
