import * as Speech from "expo-speech";
import * as FileSystem from "expo-file-system/legacy";
import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from "expo-audio";
import { withKeyParam } from "./netq";

/* SPEECH v3 — download → cache → play.
   Natural voices (OpenAI studio family via Pollinations, keyless). The clip
   is saved to disk first (repeat lines play instantly), and if ANY step
   stalls beyond 8s the device voice takes over. Silence is impossible. */

export type VoiceId = string; // "gb" | "us" | "device" (+legacy fable/ballad/nova/echo)
let currentVoice: VoiceId = "gb";
let player: AudioPlayer | null = null;
let ready = false;
let deviceVoiceId: string | undefined;
let seq = 0; // ignore late downloads after the user moved on

export function setVoice(v: VoiceId) { currentVoice = v; }

export async function initSpeech() {
  if (ready) return;
  try { await setAudioModeAsync({ playsInSilentMode: true }); } catch {}
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const gb = voices.filter((v) => v.language?.toLowerCase().startsWith("en-gb"));
    gb.sort((a, b) => ((b.identifier || "").includes("enhanced") ? 1 : 0) - ((a.identifier || "").includes("enhanced") ? 1 : 0));
    deviceVoiceId = gb[0]?.identifier;
  } catch {}
  ready = true;
}

const deviceSpeak = (text: string) => {
  try {
    Speech.stop();
    Speech.speak(text, { language: "en-GB", voice: deviceVoiceId, rate: 0.95 });
  } catch {}
};

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
};

const TTS_DIR = FileSystem.cacheDirectory + "tts/";
let dirReady = false;
async function ensureDir() {
  if (dirReady) return;
  try { await FileSystem.makeDirectoryAsync(TTS_DIR, { intermediates: true }); } catch {}
  dirReady = true;
}

const raceTO = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

async function tryDownload(url: string, dest: string, ms = 12000, headers?: Record<string, string>): Promise<boolean> {
  try {
    const res: any = await raceTO(FileSystem.downloadAsync(url, dest, headers ? { headers } : undefined), ms);
    if (!res || res.status < 200 || res.status >= 300) return false;
    const info = await FileSystem.getInfoAsync(dest);
    if (!info.exists || (info.size ?? 0) < 1500) return false;
    const head = await FileSystem.readAsStringAsync(dest, { encoding: "base64", position: 0, length: 9 } as any);
    if (head.startsWith("PGh0") || head.startsWith("PCFE") || head.startsWith("eyJ")) return false; // html/json body
    return true;
  } catch { return false; }
}

const LOCALE: Record<string, string> = { gb: "en-GB", us: "en-US", fable: "en-GB", ballad: "en-GB", nova: "en-US", echo: "en-US" };

async function fetchClip(text: string, voice: string): Promise<string | null> {
  await ensureDir();
  const dest = `${TTS_DIR}${voice}_${hash(text)}.mp3`;
  const info = await FileSystem.getInfoAsync(dest).catch(() => null as any);
  if (info?.exists && (info.size ?? 0) > 1500) return dest;
  const tl = LOCALE[voice] ?? "en-GB";
  const q = encodeURIComponent(text.slice(0, 180)); // service caps ~200 chars
  // layer 1: Google Translate TTS — keyless, natural, alive since 2009
  const g = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${q}`;
  if (await tryDownload(g, dest, 9000, { "User-Agent": "Mozilla/5.0" })) return dest;
  // layer 2: pollinations premium (only bites if the account has Pollen)
  const p = await withKeyParam(`https://gen.pollinations.ai/audio/${q}?voice=${voice === "us" ? "nova" : "fable"}`);
  if (await tryDownload(p, dest)) return dest;
  return null; // layer 3 = device voice via caller timer
}

export function speak(text: string, timeoutMs = 6000) {
  text = text.replace(/_{2,}/g, " blank ");
  stopSpeech();
  const mySeq = ++seq;
  if (currentVoice === "device") { deviceSpeak(text); return; }

  let fallbackFired = false;
  const fallbackTimer = setTimeout(() => {
    fallbackFired = true;
    if (mySeq === seq) deviceSpeak(text); // stalled → device voice takes over
  }, timeoutMs);

  (async () => {
    const clip = await fetchClip(text, currentVoice);
    clearTimeout(fallbackTimer);
    if (mySeq !== seq || fallbackFired) return; // user moved on / fallback spoke
    if (!clip) { deviceSpeak(text); return; }
    try {
      player = createAudioPlayer(clip);
      player.play();
    } catch { deviceSpeak(text); }
  })();
}

export function stopSpeech() {
  seq++;
  try { Speech.stop(); } catch {}
  try { player?.pause(); player?.remove(); } catch {}
  player = null;
}
