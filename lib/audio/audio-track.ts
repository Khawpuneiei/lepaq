/**
 * Whether a picked file has a sound track, checked in the browser before it
 * is uploaded.
 *
 * A video with no sound track (a screen recording made with the microphone
 * off, say) is a valid .mp4 or .webm, so it passes the extension check, is
 * uploaded, and only fails on the GPU service. There the decoder finds no
 * audio stream and the person reads "IndexError: tuple index out of range".
 *
 * Only the container's track list is read: the `moov` box of an MP4 or M4A,
 * and the Tracks element of a WebM. That is a few kilobytes even for a long
 * recording, so the check costs nothing. Anything this cannot read answers
 * "unknown" and the file goes ahead as before; only a track list that is
 * certain to have no audio track stops it.
 */

export type AudioTrackCheck = "audio" | "no-audio" | "unknown";

/** Up to `length` bytes from `offset`; fewer at the end of the file. */
export type ReadAt = (offset: number, length: number) => Promise<Uint8Array>;

/** A moov box past this is not worth reading in a browser tab. */
const MAX_MOOV_BYTES = 64 * 1024 * 1024;
/** A WebM's Tracks element is in its first few kilobytes; this is generous. */
const WEBM_HEAD_BYTES = 1024 * 1024;

export async function checkAudioTrack(file: Blob, name: string): Promise<AudioTrackCheck> {
  const read: ReadAt = async (offset, length) =>
    new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
  const ext = name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  try {
    if (ext === ".mp3" || ext === ".wav") return "audio";
    if (ext === ".mp4" || ext === ".m4a" || ext === ".mov") return await mp4AudioTrack(read, file.size);
    if (ext === ".webm" || ext === ".mkv") return await webmAudioTrack(read, file.size);
    return "unknown";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------- MP4 / M4A

const u32 = (b: Uint8Array, at: number) =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const isFourcc = (s: string) => /^[\x20-\x7e]{4}$/.test(s);

interface Box {
  type: string;
  /** Where the payload starts and ends, relative to what was scanned. */
  start: number;
  end: number;
}

/** The boxes in one level, or null when a header does not add up. */
function boxesIn(buf: Uint8Array, from: number, to: number): Box[] | null {
  const boxes: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32(buf, at);
    const type = fourcc(buf, at + 4);
    let header = 8;
    if (!isFourcc(type)) return null;
    if (size === 1) {
      if (at + 16 > to) return null;
      size = u32(buf, at + 8) * 2 ** 32 + u32(buf, at + 12);
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) return null;
    boxes.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return boxes;
}

/** Each trak's handler type ("soun", "vide", ...) from a moov payload. */
function handlerTypes(moov: Uint8Array): string[] | null {
  const top = boxesIn(moov, 0, moov.length);
  if (!top) return null;
  const types: string[] = [];
  for (const trak of top.filter((b) => b.type === "trak")) {
    const mdia = boxesIn(moov, trak.start, trak.end)?.find((b) => b.type === "mdia");
    if (!mdia) return null;
    const hdlr = boxesIn(moov, mdia.start, mdia.end)?.find((b) => b.type === "hdlr");
    // version and flags (4), pre_defined (4), then the handler type
    if (!hdlr || hdlr.start + 12 > hdlr.end) return null;
    types.push(fourcc(moov, hdlr.start + 8));
  }
  return types;
}

export async function mp4AudioTrack(read: ReadAt, size: number): Promise<AudioTrackCheck> {
  let at = 0;
  let first = true;
  while (at + 8 <= size) {
    const head = await read(at, 16);
    if (head.length < 8) return "unknown";
    let boxSize = u32(head, 0);
    const type = fourcc(head, 4);
    let header = 8;
    if (!isFourcc(type) || (first && type !== "ftyp" && type !== "moov" && type !== "wide" && type !== "free")) {
      return "unknown";
    }
    first = false;
    if (boxSize === 1) {
      if (head.length < 16) return "unknown";
      boxSize = u32(head, 8) * 2 ** 32 + u32(head, 12);
      header = 16;
    } else if (boxSize === 0) {
      boxSize = size - at;
    }
    if (boxSize < header) return "unknown";
    if (type === "moov") {
      if (boxSize - header > MAX_MOOV_BYTES) return "unknown";
      const moov = await read(at + header, boxSize - header);
      if (moov.length < boxSize - header) return "unknown";
      const types = handlerTypes(moov);
      if (!types) return "unknown";
      return types.includes("soun") ? "audio" : "no-audio";
    }
    at += boxSize;
  }
  return "unknown";
}

// ---------------------------------------------------------------- WebM

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_TYPE = 0x83;
const CLUSTER = 0x1f43b675;
const AUDIO = 2;

/** An EBML element ID, marker bits kept, as the spec writes them. */
function readId(buf: Uint8Array, at: number): { id: number; len: number } | null {
  const first = buf[at];
  if (first === undefined || first === 0) return null;
  const len = Math.clz32(first) - 23; // leading zeros within the byte, plus one
  if (len > 4 || at + len > buf.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[at + i];
  return { id, len };
}

/** An EBML size; null size means "unknown" (all ones), as MediaRecorder writes. */
function readSize(buf: Uint8Array, at: number): { size: number | null; len: number } | null {
  const first = buf[at];
  if (first === undefined || first === 0) return null;
  const len = Math.clz32(first) - 23;
  if (len > 8 || at + len > buf.length) return null;
  let value = first & (0xff >> len);
  let allOnes = value === 0xff >> len;
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[at + i];
    if (buf[at + i] !== 0xff) allOnes = false;
  }
  return { size: allOnes ? null : value, len };
}

export async function webmAudioTrack(read: ReadAt, size: number): Promise<AudioTrackCheck> {
  const buf = await read(0, Math.min(size, WEBM_HEAD_BYTES));
  let at = 0;
  let sawEbml = false;
  let inSegment = false;
  let end = buf.length;

  while (at < end) {
    const id = readId(buf, at);
    if (!id) return "unknown";
    const sz = readSize(buf, at + id.len);
    if (!sz) return "unknown";
    const body = at + id.len + sz.len;

    if (!sawEbml) {
      if (id.id !== EBML || sz.size === null) return "unknown";
      sawEbml = true;
      at = body + sz.size;
      continue;
    }
    if (!inSegment) {
      if (id.id !== SEGMENT) return "unknown";
      inSegment = true;
      if (sz.size !== null) end = Math.min(end, body + sz.size);
      at = body;
      continue;
    }
    if (id.id === CLUSTER) return "unknown"; // media began before any track list
    if (sz.size === null) return "unknown";
    if (id.id === TRACKS) {
      if (body + sz.size > buf.length) return "unknown";
      return tracksHaveAudio(buf, body, body + sz.size);
    }
    at = body + sz.size;
  }
  return "unknown";
}

function tracksHaveAudio(buf: Uint8Array, from: number, to: number): AudioTrackCheck {
  let at = from;
  while (at < to) {
    const id = readId(buf, at);
    const sz = id && readSize(buf, at + id.len);
    if (!id || !sz || sz.size === null) return "unknown";
    const body = at + id.len + sz.len;
    if (id.id === TRACK_ENTRY) {
      let inner = body;
      while (inner < body + sz.size) {
        const cid = readId(buf, inner);
        const csz = cid && readSize(buf, inner + cid.len);
        if (!cid || !csz || csz.size === null) return "unknown";
        const cbody = inner + cid.len + csz.len;
        if (cid.id === TRACK_TYPE) {
          let type = 0;
          for (let i = 0; i < csz.size; i++) type = type * 256 + buf[cbody + i];
          if (type === AUDIO) return "audio";
        }
        inner = cbody + csz.size;
      }
    }
    at = body + sz.size;
  }
  return "no-audio";
}
