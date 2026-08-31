export type PlaybackTrack = {
  key: string;
  url: string;
  fileName: string;
  mimeType: string;
  format: string;
  expiresAtMs: number;
  via: "preview" | "blob";
  sizeBytes?: number;
};

export type PlaybackSnapshot = {
  track: PlaybackTrack | null;
  currentTime: number;
  duration: number | null;
  paused: boolean;
  waiting: boolean;
  error: string | null;
};

const EMPTY_SNAPSHOT: PlaybackSnapshot = {
  track: null,
  currentTime: 0,
  duration: null,
  paused: true,
  waiting: false,
  error: null,
};

export function clampSeekTime(seconds: number, duration: number | null): number {
  if (!Number.isFinite(seconds)) return 0;
  const lowerBounded = Math.max(0, seconds);
  return duration != null && Number.isFinite(duration)
    ? Math.min(lowerBounded, duration)
    : lowerBounded;
}

class PlaybackController {
  private audio: HTMLAudioElement | null = null;
  private snapshot: PlaybackSnapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => this.snapshot;

  setTrack(track: PlaybackTrack) {
    if (this.snapshot.track?.key === track.key) {
      if (track.via === "blob" && track.url !== this.snapshot.track.url) {
        URL.revokeObjectURL(track.url);
      }
      return;
    }

    const audio = this.getAudio();
    audio.pause();
    this.revokeCurrentBlob();
    audio.removeAttribute("src");
    audio.load();

    this.update({
      track,
      currentTime: 0,
      duration: null,
      paused: true,
      waiting: true,
      error: null,
    });
    audio.src = track.url;
    audio.load();
    this.updateMediaSession(track);
  }

  async toggle() {
    const audio = this.getAudio();
    if (!this.snapshot.track) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch (cause) {
      this.update({
        error: cause instanceof Error ? cause.message : "Playback could not start.",
      });
    }
  }

  seek(seconds: number) {
    const audio = this.getAudio();
    if (!this.snapshot.track) return;
    const next = clampSeekTime(seconds, this.snapshot.duration);
    audio.currentTime = next;
    this.update({ currentTime: next, error: null });
  }

  clear() {
    if (!this.audio) {
      this.snapshot = EMPTY_SNAPSHOT;
      return;
    }
    this.audio.pause();
    this.revokeCurrentBlob();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.update(EMPTY_SNAPSHOT);
    this.clearMediaSession();
  }

  destroy() {
    this.clear();
    this.listeners.clear();
    this.audio = null;
  }

  private getAudio() {
    if (this.audio) return this.audio;
    const audio = document.createElement("audio");
    audio.preload = "auto";
    audio.addEventListener("loadedmetadata", () => this.syncFromAudio());
    audio.addEventListener("durationchange", () => this.syncFromAudio());
    audio.addEventListener("timeupdate", () => this.syncFromAudio());
    audio.addEventListener("play", () => this.syncFromAudio());
    audio.addEventListener("pause", () => this.syncFromAudio());
    audio.addEventListener("playing", () => this.syncFromAudio());
    audio.addEventListener("waiting", () => this.syncFromAudio(true));
    audio.addEventListener("ended", () => this.syncFromAudio());
    audio.addEventListener("error", () => {
      const track = this.snapshot.track;
      this.update({
        paused: true,
        waiting: false,
        error: track
          ? `This browser could not decode ${track.format} (${track.mimeType}).`
          : "This browser could not decode the audio file.",
      });
    });
    this.audio = audio;
    return audio;
  }

  private syncFromAudio(forceWaiting = false) {
    if (!this.audio) return;
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : null;
    this.update({
      currentTime: Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0,
      duration,
      paused: this.audio.paused,
      waiting: forceWaiting ? true : this.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA,
    });
    this.updatePositionState();
  }

  private update(next: Partial<PlaybackSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }

  private revokeCurrentBlob() {
    const current = this.snapshot.track;
    if (current?.via === "blob") URL.revokeObjectURL(current.url);
  }

  private updateMediaSession(track: PlaybackTrack) {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.fileName });
    navigator.mediaSession.setActionHandler("play", () => void this.toggle());
    navigator.mediaSession.setActionHandler("pause", () => void this.toggle());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime != null) this.seek(details.seekTime);
    });
  }

  private updatePositionState() {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    const { duration, currentTime } = this.snapshot;
    if (duration == null || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: this.audio?.playbackRate ?? 1,
        position: clampSeekTime(currentTime, duration),
      });
    } catch {
      // Some browsers reject position updates while metadata is settling.
    }
  }

  private clearMediaSession() {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = null;
    for (const action of ["play", "pause", "seekto"] as const) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        // Ignore unsupported media-session actions.
      }
    }
  }
}

export const playback = new PlaybackController();
