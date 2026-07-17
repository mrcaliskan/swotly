import * as FileSystem from "expo-file-system/legacy";
import { createAudioPlayer } from "expo-audio";

/* SFX — tiny UI sounds synthesised at runtime (16-bit mono WAV written to
   cache on first use). No bundled assets, no new dependencies: expo-audio
   is already here for TTS. Callers gate on the sound setting; playSfx
   itself never throws. */

export type SfxKind = "ok" | "bad" | "tick" | "fanfare";

const SR = 16000;
const DIR = FileSystem.cacheDirectory + "sfx/";
const V = 3; // bump to regenerate cached files after changing a sound
const paths: Partial<Record<SfxKind, string>> = {};
let building: Promise<void> | null = null;

function tone(freq: number, dur: number, vol = 0.4): Float32Array {
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const attack = Math.min(1, i / (SR * 0.006));
    const decay = Math.exp((-4 * t) / dur);
    // sine + a whisper of 2nd harmonic = warmer than a raw beep
    out[i] = (Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(4 * Math.PI * freq * t)) * attack * decay * vol;
  }
  return out;
}

function join(parts: Float32Array[], overlap = 0): Float32Array {
  const step = parts.map((p) => Math.max(1, p.length - Math.floor(SR * overlap)));
  const total = step.slice(0, -1).reduce((s, x) => s + x, 0) + parts[parts.length - 1].length;
  const out = new Float32Array(total);
  let at = 0;
  parts.forEach((p, i) => {
    for (let k = 0; k < p.length; k++) out[at + k] += p[k];
    at += step[i];
  });
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function wavBase64(samples: Float32Array): string {
  const dataLen = samples.length * 2;
  const buf = new Uint8Array(44 + dataLen);
  const w32 = (o: number, v: number) => { buf[o] = v & 255; buf[o + 1] = (v >> 8) & 255; buf[o + 2] = (v >> 16) & 255; buf[o + 3] = (v >> 24) & 255; };
  const w16 = (o: number, v: number) => { buf[o] = v & 255; buf[o + 1] = (v >> 8) & 255; };
  const tag = (o: number, s: string) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); };
  tag(0, "RIFF"); w32(4, 36 + dataLen); tag(8, "WAVE");
  tag(12, "fmt "); w32(16, 16); w16(20, 1); w16(22, 1); w32(24, SR); w32(28, SR * 2); w16(32, 2); w16(34, 16);
  tag(36, "data"); w32(40, dataLen);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    w16(44 + i * 2, (v < 0 ? v * 32768 : v * 32767) | 0);
  }
  let s = "";
  for (let i = 0; i < buf.length; i += 3) {
    const a = buf[i], b = i + 1 < buf.length ? buf[i + 1] : 0, c = i + 2 < buf.length ? buf[i + 2] : 0;
    s += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)]
      + (i + 1 < buf.length ? B64[((b & 15) << 2) | (c >> 6)] : "=")
      + (i + 2 < buf.length ? B64[c & 63] : "=");
  }
  return s;
}

async function ensure(): Promise<void> {
  if (paths.ok) return;
  if (building) return building;
  building = (async () => {
    try { await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }); } catch {}
    const sounds: Record<SfxKind, Float32Array> = {
      ok: join([tone(659, 0.09, 0.35), tone(880, 0.16, 0.35)], 0.02),          // rising E5→A5 chime
      bad: join([tone(233, 0.1, 0.3), tone(196, 0.2, 0.3)], 0.015),            // gentle falling thud
      tick: tone(1250, 0.045, 0.18),                                            // soft click for Next
      fanfare: join([tone(523, 0.12, 0.32), tone(659, 0.12, 0.32), tone(784, 0.12, 0.32), tone(1046, 0.34, 0.36)], 0.03),
    };
    for (const k of Object.keys(sounds) as SfxKind[]) {
      const p = DIR + k + V + ".wav";
      const info = await FileSystem.getInfoAsync(p).catch(() => null);
      if (!info?.exists) await FileSystem.writeAsStringAsync(p, wavBase64(sounds[k]), { encoding: FileSystem.EncodingType.Base64 });
      paths[k] = p;
    }
  })().catch(() => { building = null; });
  return building;
}

export async function playSfx(kind: SfxKind) {
  try {
    await ensure();
    const uri = paths[kind];
    if (!uri) return;
    const p = createAudioPlayer({ uri });
    p.play();
    setTimeout(() => { try { p.remove(); } catch {} }, 2500);
  } catch {}
}
