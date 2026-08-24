/** Lowercase extensions this opener claims. Skip `mp4`/`webm` — those are often video. */
export const AUDIO_EXTENSIONS = [
  "m4a",
  "m4b",
  "m4r",
  "mp3",
  "wav",
  "wave",
  "ogg",
  "oga",
  "flac",
  "aac",
  "opus",
  "weba",
  "aiff",
  "aif",
  "caf",
] as const;

export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];

const MIME_BY_EXT: Record<AudioExtension, string> = {
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  m4r: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  wave: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  opus: "audio/opus",
  weba: "audio/webm",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  caf: "audio/x-caf",
};

/** BB's createPreview rejects ttlMs above one hour. */
export const PREVIEW_TTL_MS = 60 * 60 * 1000;

export function extensionOf(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function fileNameOf(path: string): string {
  const parts = path.split(/[/\\]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function mimeForPath(path: string): string {
  const ext = extensionOf(path);
  if (ext in MIME_BY_EXT) return MIME_BY_EXT[ext as AudioExtension];
  return "application/octet-stream";
}

export function formatLabel(path: string): string {
  const ext = extensionOf(path);
  return ext ? ext.toUpperCase() : "AUDIO";
}

export function splitRelativeSegments(path: string): string[] {
  const parts = path.split(/[/\\]+/).filter((part) => part.length > 0 && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new Error("Audio path must stay inside its file root.");
  }
  if (parts.length === 0) {
    throw new Error("Audio path is empty.");
  }
  return parts;
}

export function joinPreviewUrl(baseUrl: string, relativePath: string): string {
  const prefix = baseUrl.replace(/\/+$/, "");
  return `${prefix}/${splitRelativeSegments(relativePath).map(encodeURIComponent).join("/")}`;
}

export function joinHostPath(rootPath: string, relativePath: string): string {
  const root = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return `${root}/${splitRelativeSegments(relativePath).join("/")}`;
}

export function splitAbsoluteFile(path: string): { dir: string; name: string } {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized.startsWith("/")) {
    throw new Error("Host audio path must be absolute.");
  }
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0 || idx === normalized.length - 1) {
    throw new Error("Host audio path must include a file name.");
  }
  return { dir: normalized.slice(0, idx), name: normalized.slice(idx + 1) };
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(rest).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
