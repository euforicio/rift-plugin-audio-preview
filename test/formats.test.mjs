import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUDIO_EXTENSIONS,
  PREVIEW_TTL_MS,
  extensionOf,
  fileNameOf,
  formatBytes,
  formatClock,
  formatLabel,
  joinHostPath,
  joinPreviewUrl,
  mimeForPath,
  splitAbsoluteFile,
  splitRelativeSegments,
} from "../lib/formats.ts";

test("m4a is audio/mp4 — the MIME BB's built-in preview refuses", () => {
  assert.equal(mimeForPath("music-tense-clockwork-combo.m4a"), "audio/mp4");
  assert.equal(formatLabel("apps/web/public/audio/x.m4a"), "M4A");
  assert.ok(AUDIO_EXTENSIONS.includes("m4a"));
  assert.ok(!AUDIO_EXTENSIONS.includes("mp4"));
});

test("joins preview URLs with encoded segments", () => {
  assert.equal(
    joinPreviewUrl("http://127.0.0.1:38886/previews/abc/", "apps/web/public/audio/track.m4a"),
    "http://127.0.0.1:38886/previews/abc/apps/web/public/audio/track.m4a",
  );
  assert.equal(
    joinPreviewUrl("http://x/p", "folder/track name.m4a"),
    "http://x/p/folder/track%20name.m4a",
  );
});

test("rejects path escape and empty relative paths", () => {
  assert.throws(() => splitRelativeSegments("../secret.m4a"), /stay inside/);
  assert.throws(() => splitRelativeSegments(""), /empty/);
  assert.deepEqual(splitRelativeSegments("./music/a.m4a"), ["music", "a.m4a"]);
});

test("splits host files and formats clocks", () => {
  assert.deepEqual(splitAbsoluteFile("/tmp/audio/track.m4a"), {
    dir: "/tmp/audio",
    name: "track.m4a",
  });
  assert.equal(joinHostPath("/tmp/audio", "track.m4a"), "/tmp/audio/track.m4a");
  assert.equal(fileNameOf("apps/web/public/audio/track.m4a"), "track.m4a");
  assert.equal(extensionOf("track.M4A"), "m4a");
  assert.equal(formatClock(75), "1:15");
  assert.equal(formatClock(3661), "1:01:01");
  assert.equal(formatBytes(1500), "1.5 KB");
  assert.ok(PREVIEW_TTL_MS <= 3_600_000);
});
