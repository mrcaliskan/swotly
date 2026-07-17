import * as SecureStore from "expo-secure-store";
import { AppData, Category, CATEGORIES, Concept, Exercise, todayKey } from "./types";

/* ------------------------------------------------------------------
   AI layer. Today: direct Anthropic call with the user's own key
   (stored in the device keychain). When we productise, only this
   file changes: point BASE_URL at our backend proxy and drop the key.
   ------------------------------------------------------------------ */

const KEY_NAME = "swotly_anthropic_key";
const BASE_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const CHUNK_CHARS = 4500;

export const getApiKey = () => SecureStore.getItemAsync(KEY_NAME);
export const setApiKey = (k: string) => SecureStore.setItemAsync(KEY_NAME, k.trim());
export const clearApiKey = () => SecureStore.deleteItemAsync(KEY_NAME);

function splitIntoChunks(text: string): string[] {
  const blocks = text.split(/(?=^##?\s*Lesson\b)/im).filter((s) => s.trim());
  const chunks: string[] = [];
  for (const block of blocks.length > 1 ? blocks : [text]) {
    if (block.length <= CHUNK_CHARS) { chunks.push(block); continue; }
    let rest = block;
    while (rest.length > CHUNK_CHARS) {
      let cut = rest.lastIndexOf("\n\n", CHUNK_CHARS);
      if (cut < CHUNK_CHARS * 0.4) cut = CHUNK_CHARS;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest.trim()) chunks.push(rest);
  }
  return chunks;
}

function salvageJson(text: string): any {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  if (start === -1) throw new Error("no JSON in response");
  const body = clean.slice(start);
  try { return JSON.parse(body); } catch {}

  /* Generic repair: walk the string tracking quote state and an open-bracket
     stack; cut back to the last safe boundary and close whatever remains.
     Handles truncation at ANY nesting depth. */
  const repair = (src: string): any => {
    const stack: string[] = [];
    let inStr = false, esc = false, lastSafe = -1;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") { stack.pop(); lastSafe = i; }
      else if (ch === ",") lastSafe = i - 1;
    }
    // try progressively earlier safe cut points
    for (let attempt = 0; attempt < 40; attempt++) {
      const cut = attempt === 0 ? src.length : src.lastIndexOf("}", (lastSafe = lastSafe - 1) >= 0 ? lastSafe : 0);
      if (cut <= 0) break;
      let candidate = src.slice(0, attempt === 0 ? cut : cut + 1);
      // recount stack for candidate
      const st: string[] = [];
      let q = false, e2 = false;
      for (let i = 0; i < candidate.length; i++) {
        const c = candidate[i];
        if (e2) { e2 = false; continue; }
        if (c === "\\") { e2 = true; continue; }
        if (c === '"') { q = !q; continue; }
        if (q) continue;
        if (c === "{" || c === "[") st.push(c);
        else if (c === "}" || c === "]") st.pop();
      }
      if (q) candidate += '"';
      candidate = candidate.replace(/,\s*$/, "");
      const closers = st.reverse().map((c) => (c === "{" ? "}" : "]")).join("");
      try {
        const fixed = JSON.parse(candidate + closers);
        if (fixed && typeof fixed === "object") return fixed;
      } catch { /* try an earlier cut */ }
    }
    throw new Error("could not salvage JSON");
  };
  const fixed = repair(body);
  if (!fixed.concepts) fixed.concepts = [];
  return fixed;
}

/* prompts that only make sense with visible options ("Which is NOT…?", odd-one-out) */
export const SELECTION_RE = /\bwhich\b[^?]*\b(not|following|these|option|sentence)\b|\bodd one out\b/i;

const PROMPT = (notes: string, titles: string[]) => `You are the analysis engine of Swotly, a British-English revision app. A learner pastes lesson notes from sessions with their English coach. Analyse them and return ONLY valid JSON — no markdown fences, no preamble, no trailing text. Your reply has a hard length limit: if space runs short, STOP adding concepts and close every bracket — complete JSON with fewer concepts always beats truncated JSON.

Schema:
{"concepts":[{"title":"short concept name","category":"Grammar|Vocabulary|Pronunciation|Phrases|Other","summary":"one sentence, max 15 words","tip":"memory hook, max 12 words","emoji":"1-2 emojis that visually evoke the concept","example":"one natural British-English sentence using it, max 12 words","imageQuery":"1-3 concrete words for a photo search","isRecurring":true|false,"exercises":[
 {"type":"mcq","prompt":"question","answer":"the correct option","choices":["correct option","distractor","distractor","distractor"],"domain":"…","hint":"…"},
 {"type":"odd","prompt":"Which is NOT close in meaning to <concept>?","answer":"the odd option","choices":["odd option","synonym","synonym","synonym"],"domain":"…","hint":"…"},
 {"type":"gap","prompt":"sentence with ____ for the missing word(s)","answer":"missing word(s)","domain":"…","hint":"…"},
 {"type":"type","prompt":"produce-the-phrase question","answer":"expected answer","domain":"…","hint":"…"},
 {"type":"listen","prompt":"a natural sentence using the concept","answer":"the same sentence","domain":"…","hint":"…"},
 {"type":"stress","prompt":"the word itself, lowercase","answer":"the stressed syllable","choices":["syl","la","bles","in","spoken","order"],"domain":"…","hint":"…"}
]}]}

Rules — BE TERSE, the reply is truncated if long:
- Extract EVERY distinct teachable concept in these notes, up to 8 per reply. Do not skip minor ones.
- Text wrapped in **bold** or *italics* was highlighted by the coach — treat it as HIGH PRIORITY and always turn it into a concept.
- 3 exercises per concept, at least 2 different types. Favour mcq and gap for recognition; type and listen for production.
- gap and type answers must be SHORT: 1-4 words with one clearly correct form.
- listen sentences: 5-10 words, natural spoken British English. Use listen especially for Pronunciation and Phrases.
- PRONUNCIATION concepts get exactly: ① one "stress" ② one sound-match mcq ("Which word has the same vowel sound as the stressed syllable of <word>? " with 4 single-word choices; distractors spelled temptingly alike but with a different sound) ③ one listen. NEVER use gap or type to describe pronunciation in prose.
- stress (Pronunciation only): "choices" = the word's syllables IN SPOKEN ORDER, all lowercase; "answer" = the stressed syllable copied verbatim from choices and appearing EXACTLY ONCE in the list — if the stressed syllable would repeat, pick a different word form or skip the exercise; "prompt" = just the bare word.
- All prompts under 18 words. British English spelling throughout.
- DOMAIN ASSIGNMENT IS MANDATORY: every exercise carries a "domain" chosen from: work, travel, food & cooking, family & home, weather, sport, money & shopping, health, technology, socialising. Within one concept, every exercise must have a DIFFERENT domain, and none may match the example sentence's setting. Near-twins are a hard failure (e.g. "reach the quarter-final" then "reach the semi-final" is the SAME context — forbidden).
- TENSE VARIETY: when the concept is a verb or phrasal verb, vary its grammatical form across the exercises — past simple ("got through"), present perfect ("has got through"), -ing form, third person — never the base form every time.
- "hint": a short nudge (max 12 words) that points the learner the right way WITHOUT revealing or containing the answer (e.g. meaning paraphrase, first-letter clue, or usage situation).
- Notes often use "wrong -> right" corrections: make the learner produce the natural British form.
- mcq distractors must be plausible learner errors, not random words.
- Top-level optional "story": ONE coherent 40-70 word paragraph weaving 3-5 of the concepts, each tested phrase replaced by a numbered blank like [1], [2], [3]; give the phrases in order in "story.answers". The story's scenario must differ from every exercise. Shape: {"story": {"text": "Last week I [1] the meeting…", "answers": ["put off", "…"]}}.
- mcq and odd MUST carry exactly 4 "choices" including the answer verbatim. NEVER phrase a "Which…?" question as gap or type.
- gap and type prompts must NOT contain the answer, the concept phrase, or any word of it outside the blank — the sentence must force recall, never display it.
- "hint" nudges with imagery or context and NEVER contains any word of the answer.
- fix exercises: "prompt" is a sentence containing EXACTLY ONE learner mistake around the concept (wrong form, wrong particle, wrong word); "answer" is the corrected word or short phrase (1-4 words) that replaces the wrong part. Include 1 fix exercise per concept where a classic mistake exists.
- ORIGINALITY: give every scene specific texture — named people (Priya, Tom, my flatmate), concrete places (Leeds, the gym, a car boot sale), sensory detail. BAN bland template sentences ("He ___ his homework yesterday."). No two prompts in the ENTIRE reply may open with the same two words or share a sentence skeleton.
- Rotate grammatical person and tense across a concept's exercises (I/you/she/they · past/present/future/perfect).
- If a candidate concept is only a minor variant of one of the provided existing titles, SKIP it entirely — never re-teach a near-duplicate under a new name.
- VARIETY IS SACRED: within one concept, every exercise lives in a DIFFERENT everyday domain (work, travel, family, sport, food, money, weather, friendship, news…). Never reuse the example sentence's scenario or key nouns; no two prompts of a concept may share a storyline.
- Scenario uniqueness is REPLY-WIDE, not per-concept: no named person, place, or storyline may appear in two exercises anywhere in the reply, even under different concepts. Before writing each prompt, invent a scene you have not used yet.
- imageQuery: a vivid, concrete 3-6 word SCENE for generating a simple illustration of the concept (people, objects, actions, places — e.g. "exhausted man collapsed on sofa" for knackered). Idioms welcome if a scene can express them. Empty string only if truly unillustratable. NEVER names, politics, medicine, military, brands, text.
- isRecurring=true only if the concept closely matches one of: ${JSON.stringify(titles.slice(0, 80))}

NOTES:
${notes}`;

/* parallel chunk analysis bursts several requests at once, which can trip
   Anthropic's per-minute rate limit on a single big PDF/text import — retrying
   a 429 instantly just hits the same limit again, so back off first. Without
   this, EVERY chunk near the end of a large import can fail back-to-back
   (each retry counted as "done" by the progress bar, which climbs to ~85%
   on request-completion alone) and the whole import comes back empty. */
async function postMessages(apiKey: string, body: any): Promise<any> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (res.status !== 429 || attempt >= 2) break;
    await new Promise((r) => setTimeout(r, 2500 * 2 ** attempt)); // 2.5s, 5s
  }
  return res.json();
}

async function callModel(apiKey: string, prompt: string): Promise<any> {
  const data = await postMessages(apiKey, {
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  if (data.error) throw new Error(data.error.message || "API error");
  const text = (data.content || [])
    .map((i: any) => (i.type === "text" ? i.text : ""))
    .join("");
  return salvageJson(text);
}

export async function analyseNotes(
  rawText: string,
  existingTitles: string[],
  onProgress?: (i: number, n: number) => void
): Promise<{ concepts: any[]; story?: any }> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("NO_KEY");
  const chunks = splitIntoChunks(rawText);
  const all: any[] = [];
  let story: any = null;
  let lastErr: any = null;
  let doneN = 0;
  onProgress?.(1, chunks.length);
  /* chunks run 3-wide (same as the PDF path) — long notes analyse 2-3× faster.
     Cross-chunk title dedupe is handled downstream: mergeAnalysis folds
     same-title concepts together, so parallel chunks can't create doubles. */
  const parts = await pool(chunks, 3, async (chunk, i) => {
    try {
      return await callModel(apiKey, PROMPT(chunk, existingTitles));
    } catch (e) {
      lastErr = e;
      console.error(`chunk ${i + 1}/${chunks.length} failed`, e);
      return null;
    } finally {
      doneN++;
      onProgress?.(Math.min(chunks.length, doneN + (doneN < chunks.length ? 1 : 0)), chunks.length);
    }
  });
  for (const res of parts) {
    if (!res) continue;
    if (!story && res.story?.text) story = res.story;
    for (const c of res.concepts || []) all.push(c);
  }
  if (all.length === 0) throw (lastErr ?? new Error("analysis produced nothing"));
  return { concepts: all, story };
}

const rid = (p: string) => p + Math.random().toString(36).slice(2, 9);

/* ---- near-twin detection: catches "same context, new wording" repeats ---- */
const STOP = new Set("the a an to of in on at for and or but is are was were be been i you he she it we they my your his her its our their this that these those with from have has had will would".split(" "));
const promptSig = (p: string) =>
  new Set(p.toLowerCase().replace(/[^a-z']/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const sigSim = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.max(1, Math.min(a.size, b.size));
};
const firstTwo = (p: string) => p.toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/).slice(0, 2).join(" ");

export function mergeAnalysis(data: AppData, analysis: { concepts: any[]; story?: { text?: string; answers?: any[] } }, weekLabel: string, lessonId: string) {
  const next: AppData = { ...data, concepts: [...data.concepts], exercises: [...data.exercises] };
  let added = 0, refreshed = 0;
  const batchSeen: { f2: string; sg: Set<string> }[] = []; // prompts accepted in THIS import
  for (const c of analysis.concepts) {
    if (!c?.title) continue;
    const existing = next.concepts.find((e) => e.title.toLowerCase() === c.title.toLowerCase());
    let conceptId: string;
    if (existing) {
      existing.seenCount += 1;
      existing.summary = c.summary || existing.summary;
      if (!existing.emoji || existing.emoji === "📘") existing.emoji = c.emoji || existing.emoji;
      if (!existing.example) existing.example = c.example || "";
      if (!existing.imageQuery) existing.imageQuery = c.imageQuery || "";
      conceptId = existing.id; refreshed++;
    } else {
      conceptId = rid("c");
      const cat: Category = CATEGORIES.includes(c.category) ? c.category : "Other";
      const concept: Concept = {
        id: conceptId, lessonId, title: c.title, category: cat,
        summary: c.summary || "", tip: c.tip || "",
        emoji: c.emoji || "📘", example: c.example || "",
        imageQuery: c.imageQuery || "",
        weekLabel, seenCount: 1, createdOn: todayKey(),
      };
      next.concepts.push(concept); added++;
    }
    for (const ex of c.exercises || []) {
      if (!ex?.prompt || !ex?.answer) continue;
      let type = ["flashcard", "mcq", "gap", "type", "listen", "odd", "fix", "stress"].includes(ex.type) ? ex.type : "flashcard";
      /* selection questions keep their options or die — a "Which…?" prompt
         rendered open-ended is unanswerable, so we DROP instead of demoting */
      let choices: string[] = Array.isArray(ex.choices) ? ex.choices.map((c: any) => String(c).trim()).filter(Boolean) : [];
      if (type === "mcq" || type === "odd") {
        const ans = String(ex.answer).trim();
        choices = choices.filter((c, i) => choices.findIndex((k) => k.toLowerCase() === c.toLowerCase()) === i); // dedupe
        const at = choices.findIndex((c) => c.toLowerCase() === ans.toLowerCase());
        if (at >= 0) choices.splice(at, 1);
        choices = [ans, ...choices].slice(0, 4); // the answer is ALWAYS among the options
        if (choices.length < 2) continue;
      } else if (type === "stress") {
        /* syllables stay in SPOKEN order (never reordered/shuffled); the
           stressed syllable must be unambiguous — one exact hit or we drop */
        const ans = String(ex.answer).trim().toLowerCase();
        choices = choices.map((k) => k.toLowerCase());
        const hits = choices.filter((k) => k === ans).length;
        if (choices.length < 2 || choices.length > 6 || hits !== 1) continue;
      } else if (SELECTION_RE.test(ex.prompt)) continue; // "Which…?" wording smuggled into an open type
      /* duplicate & near-twin guard: exact repeats within the concept, then
         "same scene in new clothes" — heavy word-overlap vs the concept's
         existing exercises, or a shared opening/scene vs anything accepted
         earlier in THIS import (single-word prompts are exempt: too little
         signal to compare, and exact-dup already covers them) */
      const p = String(ex.prompt);
      const psig = promptSig(p);
      const dup = next.exercises.some(
        (k) => k.conceptId === conceptId &&
          (k.prompt.toLowerCase() === p.toLowerCase() ||
           (psig.size >= 3 && sigSim(psig, promptSig(k.prompt)) >= 0.6))
      );
      if (dup) continue;
      const f2 = firstTwo(p);
      const twin = batchSeen.some((b) =>
        (b.f2 === f2 && f2.includes(" ")) ||
        (psig.size >= 4 && b.sg.size >= 4 && sigSim(psig, b.sg) >= 0.7)
      );
      if (twin) continue;
      batchSeen.push({ f2, sg: psig });
      const item: Exercise = {
        id: rid("e"), conceptId, type,
        prompt: ex.prompt, answer: String(ex.answer),
        hint: typeof ex.hint === "string" ? ex.hint : undefined,
        choices: type === "mcq" || type === "odd" || type === "stress" ? choices : undefined,
        ease: 2.5, interval: 0, due: todayKey(), reps: 0, lapses: 0,
      };
      next.exercises.push(item);
    }
  }
  // story cloze: one narrative paragraph per lesson, blanks [1]..[n]
  const st = analysis.story;
  if (st?.text && Array.isArray(st.answers) && st.answers.length >= 2 && /\[1\]/.test(st.text)) {
    const cids = next.concepts.filter((c) => c.lessonId === lessonId).map((c) => c.id);
    next.stories = [...(next.stories ?? []), {
      id: rid("st"), lessonId, conceptIds: cids,
      text: String(st.text), answers: st.answers.map(String).map((x: string) => x.trim()).filter(Boolean),
    }];
  }
  return { next, added, refreshed };
}

/** Extract study-note text from a photo (Claude vision). */
export async function extractTextFromImage(base64: string, mediaType: string): Promise<string> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("NO_KEY");
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: "Transcribe every piece of study-note text in this image, preserving structure (lists, corrections like 'wrong -> right'). Return ONLY the transcribed text, nothing else." },
        ],
      }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "API error");
  return (data.content || []).map((i: any) => (i.type === "text" ? i.text : "")).join("").trim();
}

/** Analyse a PDF chunk DIRECTLY (no transcription pass): the pages go in,
 *  concepts come out. Bold/italic text is treated as the coach's highlights. */
export async function analysePdfChunk(
  chunkBase64: string,
  existingTitles: string[],
  compact = false
): Promise<{ concepts: any[]; story?: any }> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("NO_KEY");
  const data = await postMessages(apiKey, {
    model: MODEL,
    max_tokens: 4000,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: chunkBase64 } },
        { type: "text", text: PROMPT("(The notes are in the attached document pages. Text in bold or italics was highlighted by the coach — always turn it into a concept.)", existingTitles) + (compact ? "\nCOMPACT MODE: at most 4 concepts, exactly 2 exercises each, everything extra terse." : "") },
      ],
    }],
  });
  if (data.error) throw new Error(data.error.message || "API error");
  const text = (data.content || []).map((i: any) => (i.type === "text" ? i.text : "")).join("");
  return salvageJson(text);
}

/** Small concurrency pool: run workers over items with a parallelism cap. */
export async function pool<T, R>(
  items: T[], limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const k = next++;
        results[k] = await worker(items[k], k);
      }
    })
  );
  return results;
}

/** Semantic image verification: given candidate photo descriptions per
 *  concept, Claude picks the one that truly ILLUSTRATES it — or none.
 *  "Related but wrong" loses to "no picture". Batched: ~1 call per 8 concepts. */
export async function pickBestImages(
  items: { id: string; title: string; summary: string; cands: string[] }[],
  relaxed = false
): Promise<Record<string, number>> {
  const apiKey = await getApiKey();
  if (!apiKey || items.length === 0) return {};
  const listing = items.map((it) =>
    `ID ${it.id} — concept: "${it.title}" (${it.summary})\ncandidates:\n` +
    it.cands.map((c, i) => `  ${i}: ${c.slice(0, 140)}`).join("\n")
  ).join("\n\n");
  const prompt = `You are choosing illustration photos for a British-English vocabulary app. For EACH concept below, pick the candidate index whose description would genuinely help a learner visualise the concept, or -1 if none is a clear match. BE STRICT: a related-but-wrong photo is worse than no photo. Return ONLY JSON: {"picks":{"<id>":<index>,...}} — nothing else.${relaxed ? " RELAXED PASS: choose the least misleading candidate; return -1 only if a match would actively teach the WRONG meaning." : ""}\n\n${listing}`;
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  if (data.error) return {};
  const text = (data.content || []).map((i: any) => (i.type === "text" ? i.text : "")).join("");
  try { return salvageJson(text).picks ?? {}; } catch { return {}; }
}
