import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkAudioTrack } from "@/lib/audio/audio-track";

// One-second files made with ffmpeg (16x16 video, 8 kHz tone). Each answer
// matches the GPU service's decoder (faster-whisper's decode_audio): the
// "no-audio" files are exactly the ones it fails on with "IndexError: tuple
// index out of range".
const DIR = join(__dirname, "fixtures", "audio-track");
const blob = (name: string) => new Blob([readFileSync(join(DIR, name))]);

describe("checkAudioTrack", () => {
  it.each([
    ["audio.m4a", "audio"],
    ["fragmented.m4a", "audio"], // Safari's recorder writes fragmented MP4
    ["video-and-audio.mp4", "audio"],
    ["video-only.mp4", "no-audio"], // moov after the media
    ["video-only-faststart.mp4", "no-audio"], // moov first
    ["audio.webm", "audio"],
    ["streamed.webm", "audio"], // unknown sizes, as MediaRecorder writes
    ["video-and-audio.webm", "audio"],
    ["video-only.webm", "no-audio"],
    ["streamed-video-only.webm", "no-audio"],
  ])("%s -> %s", async (name, want) => {
    expect(await checkAudioTrack(blob(name), name)).toBe(want);
  });

  it("answers unknown, never no-audio, for what it cannot read", async () => {
    const bytes = readFileSync(join(DIR, "video-only.mp4"));
    const cases: [Blob, string][] = [
      [new Blob([]), "empty.mp4"],
      [new Blob(["<html>not a video</html>"]), "page.mp4"],
      [new Blob(["<html>not a video</html>"]), "page.webm"],
      [new Blob([bytes.subarray(0, 200)]), "cut-short.mp4"],
      [new Blob([readFileSync(join(DIR, "video-only.webm")).subarray(0, 40)]), "cut-short.webm"],
      [blob("video-only.mp4"), "renamed.ogg"],
    ];
    for (const [file, name] of cases) {
      expect(await checkAudioTrack(file, name), name).toBe("unknown");
    }
  });

  it("trusts MP3 and WAV by extension", async () => {
    expect(await checkAudioTrack(new Blob([]), "call.mp3")).toBe("audio");
    expect(await checkAudioTrack(new Blob([]), "call.WAV")).toBe("audio");
  });
});
