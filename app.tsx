import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginFileOpenerProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { AUDIO_EXTENSIONS, formatBytes, formatClock } from "./lib/formats";
import { playback, type PlaybackTrack } from "./lib/playback";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const player = useSyncExternalStore(
    playback.subscribe,
    playback.getSnapshot,
    playback.getSnapshot,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const trackKey = [
    source.kind,
    source.threadId ?? "",
    source.environmentId ?? "",
    source.projectId ?? "",
    path,
  ].join("\u0000");
  const isCurrentTrack = player.track?.key === trackKey;

  useEffect(() => {
    if (playback.getSnapshot().track?.key === trackKey) {
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const sourceInput = {
      kind: source.kind,
      threadId: source.threadId,
      environmentId: source.environmentId,
      projectId: source.projectId,
    };

    async function loadTrack() {
      setLoading(true);
      setError(null);
      try {
        let track: PlaybackTrack;
        try {
          const result = await rpcRef.current.call("loadBytes", {
            path,
            source: sourceInput,
          });
          const bytes = base64ToBytes(result.contentBase64);
          const copy = new Uint8Array(bytes.byteLength);
          copy.set(bytes);
          const url = URL.createObjectURL(
            new Blob([copy], { type: result.mimeType }),
          );
          track = {
            key: trackKey,
            url,
            fileName: result.fileName,
            mimeType: result.mimeType,
            format: result.format,
            expiresAtMs: Number.MAX_SAFE_INTEGER,
            via: "blob",
            sizeBytes: result.sizeBytes,
          };
        } catch {
          const result = await rpcRef.current.call("prepare", {
            path,
            source: sourceInput,
          });
          track = {
            key: trackKey,
            url: result.url,
            fileName: result.fileName,
            mimeType: result.mimeType,
            format: result.format,
            expiresAtMs: result.expiresAtMs,
            via: "preview",
          };
        }
        if (cancelled) {
          if (track.via === "blob") URL.revokeObjectURL(track.url);
          return;
        }
        playback.setTrack(track);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load this audio file.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTrack();
    return () => {
      cancelled = true;
    };
  }, [
    path,
    reload,
    source.environmentId,
    source.kind,
    source.projectId,
    source.threadId,
    trackKey,
  ]);

  const audio = isCurrentTrack ? player.track : null;
  const playbackError = isCurrentTrack ? player.error : null;
  const shownError = error ?? playbackError;

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
                {loading && !audio
                  ? "Loading audio…"
                  : [
                      audio?.format,
                      audio?.mimeType,
                      durationLabel(player.duration, audio),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {shownError ? (
            <div className="space-y-3">
              <p className="text-sm text-destructive">{shownError}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (isCurrentTrack) playback.clear();
                  setReload((value) => value + 1);
                }}
              >
                Retry
              </Button>
            </div>
          ) : loading && !audio ? (
            <div className="h-10 animate-pulse rounded-md bg-muted" />
          ) : audio ? (
            <PlayerControls
              currentTime={player.currentTime}
              duration={player.duration}
              paused={player.paused}
              waiting={player.waiting}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function PlayerControls({
  currentTime,
  duration,
  paused,
  waiting,
}: {
  currentTime: number;
  duration: number | null;
  paused: boolean;
  waiting: boolean;
}) {
  const seekMax = duration ?? 0;
  return (
    <div className="flex items-center gap-3">
      <Button
        aria-label={paused ? "Play" : "Pause"}
        className="h-9 w-9 shrink-0 rounded-full p-0"
        disabled={duration == null}
        onClick={() => void playback.toggle()}
        size="icon"
      >
        {paused ? <PlayMark /> : <PauseMark />}
      </Button>
      <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {formatClock(currentTime)}
      </span>
      <input
        aria-label="Seek"
        className="h-2 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed"
        disabled={duration == null}
        max={seekMax}
        min={0}
        onChange={(event) => playback.seek(Number(event.currentTarget.value))}
        step={0.1}
        type="range"
        value={Math.min(currentTime, seekMax)}
      />
      <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {waiting && !paused ? "…" : formatClock(duration ?? 0)}
      </span>
    </div>
  );
}

function durationLabel(
  duration: number | null,
  audio: PlaybackTrack | null,
): string | null {
  if (duration != null) return formatClock(duration);
  if (audio?.sizeBytes != null) return formatBytes(audio.sizeBytes);
  return null;
}

function PlayMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M8 5.5v13l10-6.5-10-6.5z" />
    </svg>
  );
}

function PauseMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
    </svg>
  );
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
  app.contentScripts.register({
    id: "playback-lifecycle",
    mount() {
      return () => playback.destroy();
    },
  });
  app.slots.fileOpener({
    id: "audio-player",
    title: "Audio preview",
    extensions: AUDIO_EXTENSIONS,
    component: AudioPlayer,
  });
});
