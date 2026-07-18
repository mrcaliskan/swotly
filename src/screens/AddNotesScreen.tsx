import React, { useEffect, useRef, useState } from "react";
import {
  Animated, Easing, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { AppData, Lesson, todayKey } from "../types";
import { analyseNotes, analysePdfChunk, mergeAnalysis, extractTextFromImage, pool } from "../ai";
import { splitPdf, PdfChunk } from "../pdf";
import { prefetchImages, localizeImagesInBackground } from "../images";
import { saveData, loadData } from "../storage";
import { Btn, Card, Eyebrow, H1 } from "../components/UI";
import { C } from "../theme";

type Source = { kind: "pdf" | "photo" | "file" | "paste"; name: string } | null;

const SAMPLE = `English coaching notes — mixed revision set

PHRASAL VERBS
"to get through" = to endure / finish something hard — She got through a brutal week of night shifts.
"to wind down" = to relax gradually after effort — He winds down with a walk along the river.
"to put off" = to postpone — **Stop putting off** the dentist, book it today.

VOCABULARY
"knackered" = very tired (informal British) — I'm absolutely knackered after the gym.
"to outweigh" = to be greater than — The pros clearly outweigh the cons here.

IDIOMS
"it dawned on me" = I suddenly realised — It dawned on me that I'd emailed the wrong client.
"it's my round" = my turn to buy the drinks (pub English) — Put your wallet away, it's my round.

GRAMMAR
Participle clauses: "Having finished the report, she left early." = After she had finished...
Present perfect vs past simple: "I've lost my keys" (relevant now) vs "I lost my keys yesterday" (finished time).

PRONUNCIATION
"comfortable" -> /KUMF-tuh-bul/ — three syllables, never four.`;

type PdfJob = { chunks: PdfChunk[]; totalPages: number } | null;

export default function AddNotesScreen({ data, setData, go }: {
  data: AppData; setData: (d: AppData) => void; go: (v: string) => void;
}) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<Source>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ added: number; refreshed: number; pics: number; picTotal: number } | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [pdfJob, setPdfJob] = useState<PdfJob>(null);
  const [eta, setEta] = useState("");
  const analyseStartRef = useRef(0);
  const etaSecRef = useRef(0);
  const emaRef = useRef(0);
  /* honest progress model: elapsed-time estimate between milestones,
     floored at completed work, capped at work actually in flight */
  const progRef = useRef({ t0: 0, total: 0, completed: 0, par: 1, prior: 12 });

  const fail = (e: any, fallback: string) => {
    const msg = String(e?.message ?? "");
    if (msg === "NO_KEY") {
      setError("Add your Anthropic API key in Settings first — Swotly needs it."); return;
    }
    if (/credit|billing|balance/i.test(msg)) {
      setError("Your Anthropic API credit has run out — this is separate from a Claude.ai subscription. Top up at console.anthropic.com → Billing, then try again."); return;
    }
    if (/authentication|invalid.*key|401|unauthor/i.test(msg)) {
      setError("The API key was rejected. Check it in Settings (it should start with sk-ant-) or create a fresh one at console.anthropic.com."); return;
    }
    if (/rate.?limit|429|overload/i.test(msg)) {
      setError("The API is rate-limiting right now — wait a minute and try again."); return;
    }
    setError(msg ? `${fallback}\nDetail: ${msg.slice(0, 160)}` : fallback);
  };

  const ingest = (extracted: string, src: Source) => {
    setText(extracted); setSource(src);
    if (!label && src?.name) setLabel(src.name.replace(/\.[a-z0-9]+$/i, ""));
  };

  const pickPdfOrFile = async () => {
    setError("");
    const res = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const name = asset.name ?? "file";
    const mime = asset.mimeType ?? "";
    const isPdf = mime.includes("pdf") || /\.pdf$/i.test(name);
    const isImage = mime.startsWith("image/") || /\.(png|jpe?g|heic|webp)$/i.test(name);
    const isDocx = /\.(docx?|pages)$/i.test(name);
    try {
      if (isPdf) {
        if ((asset.size ?? 0) > 25_000_000) {
          setError("That PDF is over 25 MB. Export a smaller version (File → Print → pick a page range → Save as PDF)."); return;
        }
        setBusy(true); setPct(20); setProgress("Splitting the PDF into pages…");
        const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: "base64" });
        const job = await splitPdf(b64, 8);
        setPdfJob(job);
        const est = Math.ceil(job.chunks.length / 3) * 25;
        if (est > 20) setEta(est < 60 ? `≈ ${est}s analysis ahead` : `≈ ${Math.ceil(est / 60)} min analysis ahead`);
        setText(`[PDF ready: ${job.totalPages} pages — every page will be analysed directly]`);
        setSource({ kind: "pdf", name });
        if (!label) setLabel(name.replace(/\.[a-z0-9]+$/i, ""));
      } else if (isImage) {
        setBusy(true); setPct(15); setProgress("Reading your image…");
        const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: "base64" });
        const extracted = await extractTextFromImage(b64, mime || "image/jpeg");
        ingest(extracted, { kind: "photo", name });
      } else if (isDocx) {
        setError("Word files can't be read directly yet — export as PDF instead (it keeps the bold highlights too)."); return;
      } else {
        const content = await FileSystem.readAsStringAsync(asset.uri);
        ingest(content, { kind: "file", name });
      }
    } catch (e: any) {
      fail(e, "Couldn't read that file — PDF, images, .txt and .md work best.");
    }
    setBusy(false); setProgress(""); setPct(0);
  };

  const pickPhoto = async () => {
    setError("");
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setError("Photo access was declined — allow it in iPhone Settings."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, base64: true });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    setBusy(true); setPct(15); setProgress("Reading your photo…");
    try {
      const mime = res.assets[0].mimeType ?? "image/jpeg";
      const extracted = await extractTextFromImage(res.assets[0].base64, mime);
      ingest(text ? text + "\n\n" + extracted : extracted, { kind: "photo", name: "Photo" });
    } catch (e: any) {
      fail(e, "Couldn't read the photo — try a clearer shot with good lighting.");
    }
    setBusy(false); setProgress(""); setPct(0);
  };

  const run = async () => {
    if (!pdfJob && text.trim().length < 30) {
      setError("There's not much to analyse yet — import a file or paste your notes first.");
      return;
    }
    setBusy(true); setError(""); setResult(null); setPct(3);
    analyseStartRef.current = Date.now();
    const fmtEta = (sec: number) =>
      sec <= 3 ? "almost there…" : sec < 60 ? `~${Math.round(sec)}s left` : `~${Math.ceil(sec / 60)} min left`;
    const updateEta = (completed: number, total: number) => {
      if (completed === 0) return;
      const per = (Date.now() - analyseStartRef.current) / 1000 / completed;
      emaRef.current = emaRef.current ? emaRef.current * 0.6 + per * 0.4 : per; // smooth bursty parallel finishes
      etaSecRef.current = emaRef.current * (total - completed);
      setEta(fmtEta(etaSecRef.current));
    };
    let pctBase = 3, pctTarget = 10;
    const ticker = setInterval(() => { // steady countdown + creeping bar between milestones
      if (etaSecRef.current > 0) {
        etaSecRef.current = Math.max(0, etaSecRef.current - 1);
        setEta(fmtEta(etaSecRef.current));
      }
      const pr = progRef.current;
      if (pr.t0 > 0 && pr.total > 0) {
        const elapsed = (Date.now() - pr.t0) / 1000;
        const per = emaRef.current || pr.prior; // seconds per completion (wall-clock)
        const est = 3 + 80 * Math.min(0.99, elapsed / (per * pr.total));
        const floor = 3 + 80 * (pr.completed / pr.total);
        const cap = 3 + 80 * Math.min(1, (pr.completed + pr.par) / pr.total) - 1;
        setPct((p) => Math.max(p, Math.round(Math.min(cap, Math.max(floor, est)))));
      } else {
        setPct((p) => (p < pctTarget - 1 ? Math.max(p, pctBase) + 1 : p));
      }
    }, 700);
    try {
      let analysis: { concepts: any[]; story?: any };
      if (pdfJob) {
        const titles = data.concepts.map((c) => c.title);
        let completed = 0;
        let lastErr: any = null;
        let pdfStory: any = null;
        setProgress(`Analysing ${pdfJob.totalPages} pages in parallel…`);
        progRef.current = { t0: Date.now(), total: pdfJob.chunks.length, completed: 0, par: 3, prior: 12 };
        const perChunk = await pool(pdfJob.chunks, 3, async (ch) => {
          let out: any[] = [];
          try {
            const res = await analysePdfChunk(ch.base64, titles);
            out = res.concepts ?? [];
            if (!pdfStory && (res as any).story?.text) pdfStory = (res as any).story;
          } catch (e1) {
            lastErr = e1;
            try {
              const res2 = await analysePdfChunk(ch.base64, titles, true);
              out = res2.concepts ?? [];
            } catch (e2) { lastErr = e2; console.warn("chunk", ch.from, "skipped", e2); }
          }
          completed++;
          progRef.current.completed = completed;
          setProgress(`Pages ${ch.from}–${ch.to} done · ${completed}/${pdfJob.chunks.length} sections`);
          pctBase = 3 + Math.round((completed / pdfJob.chunks.length) * 80);
          pctTarget = 3 + Math.round(((completed + 1) / pdfJob.chunks.length) * 80);
          setPct((p) => Math.max(p, pctBase)); // milestones are floors, never setbacks
          updateEta(completed, pdfJob.chunks.length);
          return out;
        });
        const all = perChunk.flat();
        if (all.length === 0) throw (lastErr ?? new Error("analysis produced nothing"));
        analysis = { concepts: all, story: pdfStory };
      } else {
      progRef.current = { t0: Date.now(), total: 1, completed: 0, par: 1, prior: 20 };
      analysis = await analyseNotes(
        text.trim(),
        data.concepts.map((c) => c.title),
        (i, total) => {
          setProgress(total > 1 ? `Analysing part ${i} of ${total}…` : "Analysing your notes…");
          progRef.current.total = total; progRef.current.completed = i - 1;
          pctBase = 3 + Math.round(((i - 1) / Math.max(1, total)) * 80);
          pctTarget = 3 + Math.round((i / Math.max(1, total)) * 80);
          setPct((p) => Math.max(p, 4, pctBase));
          updateEta(i, total);
        }
      );
      }
      progRef.current.t0 = 0; // analysis done — back to milestone mode
      pctBase = 85; pctTarget = 92;
      setPct(85); setProgress("Building your exercises…");
      const lessonLabel = label.trim() || "Lesson of " + new Date().toLocaleDateString("en-GB");
      const lesson: Lesson = { id: "l" + Math.random().toString(36).slice(2, 9), label: lessonLabel, date: todayKey() };
      const withLesson = { ...data, lessons: [...data.lessons, lesson] };
      const { next, added, refreshed } = mergeAnalysis(withLesson, analysis, lessonLabel, lesson.id);

      // prefetch pictures so they're everywhere immediately
      const fresh = next.concepts.filter((c) => c.lessonId === lesson.id);
      let picTotal = 0;
      const found = await prefetchImages(fresh, (d, tot) => { picTotal = tot; }); // photos arrive via the background pipeline
      const final = {
        ...next,
        concepts: next.concepts.map((c) => (found[c.id] ? { ...c, imageUrl: found[c.id] } : c)),
      };
      setPct(94); setProgress("Saving…");
      await saveData(final); setData(final);
      localizeImagesInBackground(loadData, saveData, setData); // fire & forget
      setPct(100);
      setResult({ added, refreshed, pics: Object.keys(found).length, picTotal });
      setText(""); setSource(null); setShowPaste(false); setPdfJob(null);
    } catch (e: any) {
      fail(e, "The analysis didn't come back cleanly. Give it another go.");
    }
    clearInterval(ticker);
    etaSecRef.current = 0; emaRef.current = 0;
    setBusy(false); setProgress(""); setPct(0); setEta("");
  };

  const ready = !!pdfJob || text.trim().length >= 30;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Eyebrow>New material</Eyebrow>
        <H1>Add a lesson</H1>
        <Text style={s.sub}>Bring in your notes however they live — Swotly reads them and writes the exercises.</Text>

        {data.concepts.length === 0 && !text && (
          <TouchableOpacity onPress={() => {
            setText(SAMPLE); setSource({ kind: "paste", name: "Sample lesson" });
            setLabel("Sample — British idioms");
          }} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
            <Text style={s.sampleLink}>New here? Try a 30-second sample lesson →</Text>
          </TouchableOpacity>
        )}

        {/* PRIMARY: import tiles */}
        <View style={s.tiles}>
          <Tile icon="📄" title="PDF or file" sub="Long docs read in stages" onPress={pickPdfOrFile} />
          <Tile icon="📷" title="Photo" sub="Paper notes, whiteboards" onPress={pickPhoto} />
        </View>

        {/* imported summary */}
        {ready && source && (
          <Card style={{ marginTop: 14, borderColor: C.pine }}>
            <Text style={s.srcTitle}>
              {source.kind === "pdf" ? "📄" : source.kind === "photo" ? "📷" : "📄"} {source.name}
            </Text>
            <Text style={s.srcMeta}>
              {pdfJob ? `${pdfJob.totalPages} pages, ${pdfJob.chunks.length} sections — full coverage ✓${eta ? " · " + eta : ""}` : `${text.length.toLocaleString()} characters extracted ✓`}
            </Text>
            {pdfJob && pdfJob.chunks.length > 6 && (
              <Text style={[s.srcMeta, { marginTop: 4, fontStyle: "italic" }]}>
                Big file — this can take up to 10 minutes. Feel free to leave the app open and check back.
              </Text>
            )}
            {!pdfJob && (
              <TouchableOpacity onPress={() => setShowPaste(true)}>
                <Text style={s.srcEdit}>Review / edit text</Text>
              </TouchableOpacity>
            )}
          </Card>
        )}

        <Text style={s.label}>Lesson name (optional)</Text>
        <TextInput
          style={s.field} value={label} onChangeText={setLabel}
          placeholder="e.g. Week 12 — conditionals & phrasal verbs"
          placeholderTextColor={C.muted}
        />

        {/* SECONDARY: paste, tucked away */}
        {!showPaste && !(ready && source) ? (
          <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} onPress={() => setShowPaste(true)}>
            <Text style={s.pasteLink}>…or paste text instead</Text>
          </TouchableOpacity>
        ) : null}
        {showPaste && (
          <>
            <Text style={s.label}>Notes text</Text>
            <TextInput
              style={[s.field, s.area]} value={text}
              onChangeText={(v) => { setText(v); if (!source) setSource({ kind: "paste", name: "" }); }}
              placeholder="Paste your notes here…"
              placeholderTextColor={C.muted} multiline textAlignVertical="top"
              scrollEnabled={false}
            />
            {text.trim().length > 0 && !text.startsWith("[PDF ready") && (() => {
              const wc = text.trim().split(/\s+/).length;
              return <Text style={{ fontSize: 12, color: C.muted, marginTop: 6, textAlign: "right" }}>{wc.toLocaleString()} words · ~{Math.max(1, Math.ceil(wc / 700))} min analysis</Text>;
            })()}
            <TouchableOpacity onPress={() => setShowPaste(false)}>
              <Text style={s.pasteLink}>Hide text ▲</Text>
            </TouchableOpacity>
          </>
        )}

        {error ? <Text style={s.error}>{error}</Text> : null}

        {busy && <AnalysisRing pct={pct} label={progress + (eta ? `\n${eta}` : "")} />}

        <Btn
          label={busy ? "Working…" : "Analyse & add to my plan"} loading={busy}
          onPress={run} disabled={!ready} kind="marigold" style={{ marginTop: 14 }}
        />

        {result && (
          <Card style={{ marginTop: 14, borderColor: C.pine }}>
            <Text style={s.okTitle}>Lesson added ✓</Text>
            <Text style={s.okBody}>
              {result.added} new concept{result.added === 1 ? "" : "s"}
              {result.refreshed > 0 ? ` and ${result.refreshed} recurring one${result.refreshed === 1 ? "" : "s"} strengthened` : ""}
              . Pictures for {result.picTotal} concepts are rendering in the
              background — they'll pop in as they're ready (then load instantly
              forever). Woven into your plan from today.
            </Text>
            <Btn label="Plan my days 🗓" kind="marigold" onPress={() => go("practise")} style={{ marginTop: 12 }} />
            <Btn label="View this lesson in Library" kind="ghost" onPress={() => go("library")} style={{ marginTop: 8 }} />
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function AnalysisRing({ pct, label }: { pct: number; label: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true })
    ).start();
  }, []);
  return (
    <View style={s.ringWrap}>
      <View style={s.ringBox}>
        <Animated.View style={[s.ring, {
          transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
        }]} />
        <Text style={s.ringPct}>{Math.round(pct)}%</Text>
      </View>
      <Text style={s.ringLabel}>{label || "Working…"}</Text>
    </View>
  );
}

const Tile = ({ icon, title, sub, onPress }: { icon: string; title: string; sub: string; onPress: () => void }) => (
  <TouchableOpacity style={s.tile} onPress={onPress} activeOpacity={0.85}>
    <Text style={{ fontSize: 30 }}>{icon}</Text>
    <Text style={s.tileTitle}>{title}</Text>
    <Text style={s.tileSub}>{sub}</Text>
  </TouchableOpacity>
);

const s = StyleSheet.create({
  wrap: { padding: 18, paddingBottom: 40 },
  sub: { color: C.muted, fontSize: 14.5, lineHeight: 21 },
  sampleLink: { color: C.clay, fontSize: 13.5, fontWeight: "800", marginTop: 12 },
  tiles: { flexDirection: "row", gap: 12, marginTop: 16 },
  tile: {
    flex: 1, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.line,
    borderRadius: 18, padding: 16, alignItems: "center",
  },
  tileTitle: { fontSize: 15, fontWeight: "700", color: C.ink, marginTop: 8 },
  tileSub: { fontSize: 11.5, color: C.muted, marginTop: 3, textAlign: "center" },
  srcTitle: { fontSize: 15, fontWeight: "700", color: C.ink },
  srcMeta: { fontSize: 12.5, color: C.pineDeep, fontWeight: "600", marginTop: 4 },
  srcEdit: { fontSize: 12.5, color: C.clay, fontWeight: "700", marginTop: 8 },
  label: { fontSize: 13, fontWeight: "700", color: C.ink, marginTop: 16, marginBottom: 6 },
  field: {
    borderWidth: 1.5, borderColor: C.line, borderRadius: 12, padding: 13,
    fontSize: 15, backgroundColor: C.card, color: C.ink,
  },
  area: { minHeight: 150, borderRadius: 14 },
  pasteLink: { fontSize: 13, color: C.clay, fontWeight: "700", marginTop: 14 },
  error: { color: C.rose, fontSize: 13, marginTop: 10, lineHeight: 19 },
  ringWrap: { alignItems: "center", marginTop: 18 },
  ringBox: { width: 110, height: 110, alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute", width: 110, height: 110, borderRadius: 55, borderWidth: 9,
    borderColor: C.sage, borderTopColor: C.clay,
  },
  ringPct: { fontSize: 24, fontWeight: "800", color: C.pineDeep },
  ringLabel: { fontSize: 13, color: C.muted, marginTop: 10, textAlign: "center", lineHeight: 18 },
  pbWrap: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  pb: { flex: 1, height: 10, backgroundColor: C.line, borderRadius: 6, overflow: "hidden" },
  pbFill: { height: "100%", backgroundColor: C.clay, borderRadius: 6 },
  pbText: { fontSize: 12.5, fontWeight: "700", color: C.pineDeep, width: 40, textAlign: "right" },
  progressText: { fontSize: 12.5, color: C.muted, marginTop: 6 },
  okTitle: { fontSize: 18, fontWeight: "600", color: C.ink },
  okBody: { fontSize: 13.5, color: C.muted, marginTop: 6, lineHeight: 20 },
});
