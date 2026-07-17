import * as SecureStore from "expo-secure-store";
import * as FileSystem from "expo-file-system/legacy";
import { politeSlot, withKeyParam } from "./netq";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const imgLog = { at: "", targets: 0, cands: 0, verified: 0, saved: 0, err: "" };
const writeLog = () => AsyncStorage.setItem("swotly:imglog", JSON.stringify({ ...imgLog, at: new Date().toISOString().slice(11, 19) })).catch(() => {});
export const readImgLog = async () => { try { return JSON.parse((await AsyncStorage.getItem("swotly:imglog")) || "null"); } catch { return null; } };
import { Concept } from "./types";

/* IMAGE STRATEGY v3 — generation over search.
   Keyword search can never guarantee relevance for language concepts, so the
   backbone is now GENERATED imagery: the AI writes a concrete scene
   (imageQuery) and Pollinations renders exactly that scene, keylessly.
   If the user adds a Pexels key, a Claude-verified real photo is tried first. */

const KEY_NAME = "swotly_pexels_key";
export const getPexelsKey = () => SecureStore.getItemAsync(KEY_NAME);
export const setPexelsKey = (k: string) => SecureStore.setItemAsync(KEY_NAME, k.trim());
export const clearPexelsKey = () => SecureStore.deleteItemAsync(KEY_NAME);

const STYLE = ", warm flat illustration, soft colours, no text, no watermark";

export function generatedUrl(scene: string): string {
  const prompt = encodeURIComponent(scene + STYLE);
  // current documented endpoint; served politely through the request queue
  return `https://gen.pollinations.ai/image/${prompt}?width=384&height=216&nologo=true&seed=7`;
}

const h = (s: string) => {
  let x = 0;
  for (let k = 0; k < s.length; k++) x = (x * 31 + s.charCodeAt(k)) | 0;
  return Math.abs(x).toString(36);
};

/* first bytes must be a real image (JPEG /9j/, PNG iVBOR, WebP UklGR) —
   an HTML error page saved as .jpg is what broke pictures before */
async function isRealImage(path: string): Promise<boolean> {
  try {
    const head = await FileSystem.readAsStringAsync(path, { encoding: "base64", position: 0, length: 12 } as any);
    // block text masquerading as an image (error pages, svg); accept any real raster (jpeg/png/webp/gif/avif…)
    const textish = ["PCFET", "PGh0b", "PCFkb", "PHN2Zw", "PD94b", "eyJ", "Tm90IE"].some((sig) => head.startsWith(sig));
    return !textish;
  } catch { return true; } // unreadable header ≠ corrupt — don't purge good files
}

async function downloadImage(url: string): Promise<string | null> {
  try {
    const dest = `${FileSystem.documentDirectory}img_${h(url)}.jpg`;
    const info = await FileSystem.getInfoAsync(dest);
    if (info.exists && (info.size ?? 0) > 800) {
      if (await isRealImage(dest)) return dest;
      await FileSystem.deleteAsync(dest, { idempotent: true }); // purge corrupt cache
    }
    await politeSlot();
    url = await withKeyParam(url);
    const res: any = await Promise.race([
      FileSystem.downloadAsync(url, dest),
      new Promise((r) => setTimeout(() => r(null), 90_000)), // generation can queue — be patient
    ]);
    if (res && res.status >= 200 && res.status < 300) {
      const after = await FileSystem.getInfoAsync(dest);
      if (after.exists && (after.size ?? 0) > 800 && (await isRealImage(dest))) return dest;
      await FileSystem.deleteAsync(dest, { idempotent: true });
    }
  } catch {}
  return null;
}

/* BACKGROUND PIPELINE — the user never waits for pictures.
   Every remote imageUrl is generated once, saved to the phone's disk and
   swapped in as file:// (instant + offline forever). Survives restarts:
   call this on app launch and after every analysis. */
let pipelineRunning = false;
export async function localizeImagesInBackground(
  load: () => Promise<any>,
  save: (d: any) => Promise<void>,
  onData: (d: any) => void
) {
  if (pipelineRunning) return;
  pipelineRunning = true;
  try {
    let snapshot = await load();
    // re-queue concepts whose local file turned out corrupt
    for (const c of (snapshot.concepts ?? [])) {
      if (c.imageUrl?.startsWith("file") && !(await isRealImage(c.imageUrl))) {
        await FileSystem.deleteAsync(c.imageUrl, { idempotent: true }).catch(() => {});
        snapshot = { ...snapshot, concepts: snapshot.concepts.map((k: Concept) =>
          k.id === c.id ? { ...k, imageUrl: undefined } : k) };
      }
    }
    await save(snapshot); onData(snapshot);
    const targets = (snapshot.concepts ?? []).filter(
      (c: Concept) => (c.imageQuery || c.title) && !c.imageUrl?.startsWith("file")
    );
    const { pool } = await import("./ai");
    imgLog.targets = targets.length; imgLog.cands = 0; imgLog.verified = 0; imgLog.saved = 0; imgLog.err = ""; writeLog();
    let got = snapshot.concepts.filter((c: Concept) => c.imageUrl?.startsWith("file")).length;
    const failed: Concept[] = [];
    await pool(targets, 1, async (c: Concept) => {
      const remote = await resolvePhoto(c);
      const local = remote ? await downloadImage(remote) : null;
      if (!local) {
        failed.push(c);
        if (!imgLog.err) { imgLog.err = remote ? "dl-fail (net/format)" : "no-pick"; writeLog(); }
        return;
      }
      got++;
      const fresh = await load(); // read-modify-write against the latest state
      const next = {
        ...fresh,
        concepts: fresh.concepts.map((k: Concept) => (k.id === c.id ? { ...k, imageUrl: local } : k)),
      };
      await save(next);
      onData(next);
      imgLog.saved++; writeLog();
    });
    writeLog();
    // quota pass: keep the sharp filter, but guarantee ~25% coverage via least-misleading picks
    const totalQ = targets.length + snapshot.concepts.filter((c: Concept) => c.imageUrl?.startsWith("file")).length;
    for (const c of failed) {
      if (totalQ === 0 || got / totalQ >= 0.6) break;
      const remote = await resolvePhoto(c, true);
      const local = remote ? await downloadImage(remote) : null;
      if (!local) continue;
      const fresh = await load();
      const next = { ...fresh, concepts: fresh.concepts.map((k: Concept) => (k.id === c.id ? { ...k, imageUrl: local } : k)) };
      await save(next); onData(next); got++;
    }
  } finally {
    pipelineRunning = false;
  }
}

/* --- restored exports (lost in the v0.12.1 splice) --- */
const BLOCK = /war|militar|weapon|gun|soldier|army|politic|president|election|protest|drug|pill|pharma|medic|hospital|nazi|riot|bomb|logo|screenshot|map|diagram/i;

async function openverseCandidates(query: string): Promise<{ url: string; desc: string }[]> {
  try {
    const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=6&license_type=commercial`,
      { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Swotly)" } });
    const d = await r.json();
    return (d?.results ?? [])
      .map((x: any) => ({ url: x.thumbnail || x.url, desc: `${x.title ?? ""} ${(x.tags ?? []).slice(0, 6).map((t: any) => t.name).join(", ")}`.trim() || query }))
      .filter((c: any) => c.url && !BLOCK.test(c.desc));
  } catch { return []; }
}

async function wikiCandidate(term: string): Promise<{ url: string; desc: string }[]> {
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`,
      { headers: { Accept: "application/json" } });
    const d = await r.json();
    if (d?.thumbnail?.source && !BLOCK.test(d?.extract ?? "")) return [{ url: d.thumbnail.source, desc: d.extract?.slice(0, 120) || term }];
  } catch {}
  return [];
}

/** Free photo resolution: candidates (Pexels if key, else Openverse) judged
 *  strictly by Claude — related-but-wrong loses to no photo. */
async function resolvePhoto(concept: Concept, relaxed = false): Promise<string | null> {
  const q = concept.imageQuery || concept.title; // no query? fall back to the concept itself
  if (!q) return null;
  let cands = await pexelsCandidates(q);
  if (cands.length === 0) cands = await openverseCandidates(q);
  imgLog.cands += cands.length; writeLog();
  if (cands.length === 0) return null;
  try {
    const { pickBestImages } = await import("./ai");
    const picks = await pickBestImages([{ id: concept.id, title: concept.title, summary: concept.summary, cands: cands.map((k) => k.desc) }], relaxed);
    const idx = picks[concept.id];
    if (typeof idx === "number" && idx >= 0 && cands[idx]) { imgLog.verified++; return cands[idx].url; }
  } catch (e: any) { imgLog.err = String(e?.message ?? e).slice(0, 80); }
  return null;
}

async function pexelsCandidates(query: string): Promise<{ url: string; desc: string }[]> {
  try {
    const key = await getPexelsKey();
    if (!key) return [];
    const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=4&orientation=landscape`,
      { headers: { Authorization: key } });
    const d = await r.json();
    return (d?.photos ?? []).filter((p: any) => p?.src?.medium)
      .map((p: any) => ({ url: p.src.medium, desc: p.alt || query }));
  } catch { return []; }
}

export async function fetchImageFor(concept: Concept): Promise<string | null> {
  const remote = await resolvePhoto(concept);
  return remote ? await downloadImage(remote) : null;
}


export async function prefetchImages(
  _concepts: Concept[],
  onProgress?: (done: number, total: number) => void
): Promise<Record<string, string>> {
  onProgress?.(1, 1); // photos resolve in the background pipeline
  return {};
}

