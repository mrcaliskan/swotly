import React, { useState } from "react";
import { Alert, Image, LayoutAnimation, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { AppData, PendingSession, todayKey } from "../types";
import { saveData } from "../storage";
import { Card, Chip, Eyebrow, H1, Btn, ImgLoad, ConceptVisual, catTone, lessonTone } from "../components/UI";
import { C } from "../theme";

export default function LibraryScreen({ data, setData, startSession }: {
  data: AppData; setData: (d: AppData) => void; startSession: (p: PendingSession) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [showHist, setShowHist] = useState(false);
  const [mode, setMode] = useState<"lesson" | "category">("lesson");
  const lessons = [...data.lessons].sort((a, b) => (a.date < b.date ? 1 : -1));
  const orphans = data.concepts.filter((c) => !c.lessonId || !data.lessons.some((l) => l.id === c.lessonId));

  /* cascade removal: concepts → exercises → stories → plan days (empty days drop) */
  const removeConcepts = async (cids: Set<string>, lessonId?: string) => {
    const exIds = new Set(data.exercises.filter((e) => cids.has(e.conceptId)).map((e) => e.id));
    let plan = data.studyPlan;
    if (plan) {
      const days = plan.days
        .map((d) => ({ ...d, conceptIds: d.conceptIds.filter((id) => !cids.has(id)), exerciseIds: d.exerciseIds.filter((id) => !exIds.has(id)) }))
        .filter((d) => d.exerciseIds.length > 0);
      plan = days.length ? { ...plan, days } : null;
    }
    const next = {
      ...data,
      lessons: lessonId ? data.lessons.filter((l) => l.id !== lessonId) : data.lessons,
      concepts: data.concepts.filter((c) => !cids.has(c.id)),
      exercises: data.exercises.filter((e) => !exIds.has(e.id)),
      stories: (data.stories ?? []).filter((st) => (lessonId ? st.lessonId !== lessonId : !st.conceptIds.some((id) => cids.has(id)))),
      studyPlan: plan,
    };
    setData(next); await saveData(next);
  };

  const confirmDeleteLesson = (l: { id: string; label: string }) => {
    const cids = new Set(data.concepts.filter((c) => c.lessonId === l.id).map((c) => c.id));
    Alert.alert("Delete this lesson?", `"${l.label}" and its ${cids.size} concepts, exercises and plan entries will be removed. This can't be undone.`,
      [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => removeConcepts(cids, l.id) }]);
  };

  const shelf = data.concepts.filter((c) => c.shelved);

  const unshelve = async (cid: string) => {
    const next = { ...data, concepts: data.concepts.map((c) => (c.id === cid ? { ...c, shelved: false } : c)) };
    setData(next); await saveData(next);
  };

  const [query, setQuery] = useState("");
  const practiseConcept = (cid: string) => {
    const t = todayKey();
    const exs = data.exercises.filter((e) => e.conceptId === cid);
    const due = exs.filter((e) => e.due <= t);
    const rest = exs.filter((e) => e.due > t);
    const ids = [...due, ...rest].slice(0, 10).map((e) => e.id);
    if (ids.length === 0) return;
    startSession({ ids, stepIdx: 0, results: [], style: data.settings.learningStyle ?? "quiz" });
  };

  const practiseShelf = () => {
    const t = todayKey();
    const cids = new Set(shelf.map((c) => c.id));
    const exs = data.exercises.filter((e) => cids.has(e.conceptId));
    const due = exs.filter((e) => e.due <= t);
    const rest = exs.filter((e) => e.due > t);
    const ids = [...due, ...rest].slice(0, 15).map((e) => e.id);
    if (ids.length === 0) return;
    startSession({ ids, stepIdx: 0, results: [], style: data.settings.learningStyle ?? "quiz" });
  };

  const confirmDeleteConcept = (c: { id: string; title: string }) => {
    Alert.alert("Remove this concept?", `"${c.title}" and its exercises will be removed from the library and the plan.`,
      [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => removeConcepts(new Set([c.id])) }]);
  };

  const practiseLesson = (lessonId: string | null) => {
    const conceptIds = data.concepts
      .filter((c) => (lessonId ? c.lessonId === lessonId : orphans.includes(c)))
      .map((c) => c.id);
    const t = todayKey();
    const exs = data.exercises.filter((e) => conceptIds.includes(e.conceptId));
    const due = exs.filter((e) => e.due <= t);
    const rest = exs.filter((e) => e.due > t);
    const ids = [...due, ...rest].slice(0, 15).map((e) => e.id);
    if (ids.length === 0) return;
    const pending: PendingSession = {
      ids, stepIdx: 0, results: [],
      style: data.settings.learningStyle ?? "quiz",
    };
    startSession(pending); // ad-hoc: not saved as daily pending
  };

  const stageOf = (conceptId: string) => {
    const items = data.exercises.filter((k) => k.conceptId === conceptId);
    const minInt = items.length ? Math.min(...items.map((k) => (k.reps === 0 ? -1 : k.interval))) : -1;
    return minInt >= 21 ? 4 : minInt >= 7 ? 3 : minInt >= 1 ? 2 : minInt === 0 ? 1 : 0;
  };
  const STAGE_META = [
    { label: "new", emoji: "🌱", fg: C.muted },
    { label: "learning", emoji: "📖", fg: C.clay },
    { label: "learning", emoji: "📖", fg: C.clay },
    { label: "known", emoji: "✅", fg: C.pine },
    { label: "mastered", emoji: "🏆", fg: C.purple },
  ];

  const ConceptCard = ({ id }: { id: string }) => {
    const c = data.concepts.find((k) => k.id === id)!;
    const items = data.exercises.filter((k) => k.conceptId === c.id);
    const due = items.filter((k) => k.due <= todayKey()).length;
    const minInt = items.length ? Math.min(...items.map((k) => (k.reps === 0 ? -1 : k.interval))) : -1;
    const stage = minInt >= 21 ? 4 : minInt >= 7 ? 3 : minInt >= 1 ? 2 : minInt === 0 ? 1 : 0;
    const stageLabel = ["new", "learning", "learning", "known", "mastered"][stage];
    return (
      <Card style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
        <View>
          <ConceptVisual emoji={c.emoji} category={c.category} imageUrl={c.imageUrl} style={s.cover} />
          {(() => {
            const st = STAGE_META[stageOf(c.id)];
            return (
              <View style={[s.stageBadge, { borderColor: st.fg }]}>
                <Text style={[s.stageBadgeText, { color: st.fg }]}>{st.emoji} {st.label}</Text>
              </View>
            );
          })()}
        </View>
        <View style={{ padding: 15 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <Text style={[s.title, { flex: 1 }]}>{(c.emoji ? c.emoji + "  " : "") + c.title}</Text>
          <TouchableOpacity onPress={() => confirmDeleteConcept(c)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 13, color: C.muted }}>✕</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.summary}>{c.summary}</Text>
        {c.example ? <Text style={[s.summary, { fontStyle: "italic" }]}>"{c.example}"</Text> : null}
        {c.tip ? <Text style={[s.summary, { fontStyle: "italic" }]}>💡 {c.tip}</Text> : null}
        <View style={s.foot}>
          <Chip tone={catTone(c.category)}>{c.category}</Chip>
          <TouchableOpacity onPress={() => {
            const ids = items.map((k) => k.id);
            if (ids.length) startSession({ ids, stepIdx: 0, results: [], style: data.settings.learningStyle ?? "quiz" });
          }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.quickGo}>▶ drill</Text>
          </TouchableOpacity>
          <Text style={s.mastery}>
            {"●".repeat(Math.max(1, stage)) + "○".repeat(4 - Math.max(1, stage))} {stageLabel}
          </Text>
          <Text style={s.meta}>
            {items.length} exercises{due > 0 ? ` · ${due} due` : ""}
            {c.seenCount > 1 ? ` · seen in ${c.seenCount} lessons` : ""}
          </Text>
        </View>
        </View>
      </Card>
    );
  };

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Eyebrow>Everything you've studied</Eyebrow>
      <H1>Library</H1>

      {data.concepts.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={{ fontSize: 44 }}>📚✨</Text>
          <Text style={s.emptyTitle}>Your library is waiting</Text>
          <Text style={s.empty}>
            Add your first notes and each upload becomes a lesson here — with
            concepts, pictures and its own practice button.
          </Text>
        </View>
      ) : (
        <>
          {data.sessions.length > 0 && (
            <TouchableOpacity onPress={() => setShowHist(!showHist)}>
              <Text style={s.histToggle}>{showHist ? "Hide" : "Show"} recent sessions {showHist ? "▲" : "▼"}</Text>
            </TouchableOpacity>
          )}
          {showHist && [...data.sessions].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 7).map((sn) => (
            <View key={sn.date} style={s.histRow}>
              <Text style={s.histDate}>
                {new Date(sn.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
              </Text>
              <Text style={s.histMeta}>{sn.correct}/{sn.done} correct · +{sn.xp} XP</Text>
              {sn.concepts?.length ? (
                <Text style={s.histConcepts} numberOfLines={2}>{sn.concepts.join(" · ")}</Text>
              ) : null}
            </View>
          ))}

          <View style={s.modeRow}>
            {([["lesson", "By lesson"], ["category", "By category"]] as const).map(([v, lab]) => (
              <TouchableOpacity key={v} onPress={() => { setMode(v); setOpen(null); }}
                style={[s.modePill, mode === v && s.modePillOn]}>
                <Text style={[s.modePillText, mode === v && s.modePillTextOn]}>{lab}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={s.searchBox}>
            <Text style={{ fontSize: 14 }}>🔍</Text>
            <TextInput
              style={s.searchInput} value={query} onChangeText={setQuery}
              placeholder="Search your concepts…" placeholderTextColor={C.muted}
              autoCorrect={false} returnKeyType="search"
            />
            {query !== "" && (
              <TouchableOpacity onPress={() => setQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ fontSize: 13, fontWeight: "900", color: C.muted }}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {query.trim() !== "" && (() => {
            const q = query.trim().toLowerCase();
            const hits = data.concepts.filter((c) =>
              c.title.toLowerCase().includes(q) || c.summary.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)
            ).slice(0, 20);
            return (
              <View style={{ marginTop: 12 }}>
                {hits.length === 0
                  ? <Text style={s.note}>Nothing matches "{query.trim()}" yet.</Text>
                  : hits.map((c) => <ConceptCard key={c.id} id={c.id} />)}
              </View>
            );
          })()}

          {query.trim() === "" && mode === "category" && ["Grammar", "Vocabulary", "Pronunciation", "Phrases", "Other"].map((cat) => {
            const cs = data.concepts.filter((c) => c.category === cat);
            if (cs.length === 0) return null;
            const isOpen = open === "cat:" + cat;
            return (
              <View key={cat} style={s.lesson}>
                <TouchableOpacity style={s.lessonHead} onPress={() => setOpen(isOpen ? null : "cat:" + cat)}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.lessonLabel}>{cat}</Text>
                    <Text style={s.lessonMeta}>{cs.length} concepts</Text>
                  </View>
                  <Text style={s.chev}>{isOpen ? "▲" : "▼"}</Text>
                </TouchableOpacity>
                {isOpen && (
                  <View style={{ marginTop: 10 }}>
                    {cs.map((c) => <ConceptCard key={c.id} id={c.id} />)}
                  </View>
                )}
              </View>
            );
          })}

          {data.lessons.length === 0 && data.concepts.length === 0 && (
            <View style={s.emptyLib}>
              <Text style={{ fontSize: 44 }}>🗂</Text>
              <Text style={s.emptyLibTitle}>Your library is waiting</Text>
              <Text style={s.emptyLibSub}>Add lesson notes with the ⊕ button below — every concept you learn will live here, with pictures, progress and mastery badges.</Text>
            </View>
          )}

          {query.trim() === "" && mode === "lesson" && shelf.length > 0 && (
            <View style={s.shelfCard}>
              <TouchableOpacity style={s.shelfHead} onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen(open === "shelf" ? null : "shelf"); }}>
                <View style={s.shelfBadge}><Text style={{ fontSize: 16 }}>🔖</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.shelfTitle}>Review shelf</Text>
                  <Text style={s.shelfSub}>{shelf.length} saved for a closer look</Text>
                </View>
                <View style={s.shelfCount}><Text style={s.shelfCountText}>{shelf.length}</Text></View>
                <Text style={[s.chev, { color: C.purple }]}>{open === "shelf" ? "▲" : "▼"}</Text>
              </TouchableOpacity>
              {open === "shelf" && (
                <View style={{ marginTop: 12 }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {shelf.map((c) => (
                      <View key={c.id} style={s.shelfChip}>
                        <Text style={{ fontSize: 13 }}>{c.emoji || "📘"}</Text>
                        <Text style={s.shelfChipText} numberOfLines={1}>{c.title}</Text>
                        <TouchableOpacity onPress={() => practiseConcept(c.id)} hitSlop={{ top: 8, bottom: 8, left: 6, right: 4 }}>
                          <Text style={{ fontSize: 12, fontWeight: "900", color: C.pine }}>▶</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => unshelve(c.id)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}>
                          <Text style={{ fontSize: 12, fontWeight: "900", color: C.purple }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                  <Btn label="Practise this shelf" kind="marigold" onPress={practiseShelf} style={{ marginTop: 12 }} />
                </View>
              )}
            </View>
          )}

          {query.trim() === "" && mode === "lesson" && lessons.map((l) => {
            const cs = data.concepts.filter((c) => c.lessonId === l.id);
            const isOpen = open === l.id;
            const dueCount = data.exercises.filter((e) =>
              cs.some((c) => c.id === e.conceptId) && e.due <= todayKey()
            ).length;
            return (
              <View key={l.id} style={[s.lesson, { borderLeftWidth: 5, borderLeftColor: lessonTone(l.id).fg }]}>
                <TouchableOpacity style={s.lessonHead} onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen(isOpen ? null : l.id); }}>
                  <View style={[s.lessonBadge, { backgroundColor: lessonTone(l.id).bg }]}>
                    <Text style={{ fontSize: 16, fontWeight: "900", color: lessonTone(l.id).fg }}>{(l.label || "?").trim()[0]?.toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.lessonLabel, { color: lessonTone(l.id).fg }]}>{l.label}</Text>
                    <Text style={s.lessonMeta}>
                      {new Date(l.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ·{" "}
                      {cs.length} concepts{dueCount > 0 ? ` · ${dueCount} due` : ""} · 🏆 {cs.filter((c) => stageOf(c.id) === 4).length} mastered
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => confirmDeleteLesson(l)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ marginRight: 10 }}>
                    <Text style={{ fontSize: 15 }}>🗑</Text>
                  </TouchableOpacity>
                  <Text style={s.chev}>{isOpen ? "▲" : "▼"}</Text>
                </TouchableOpacity>
                {(() => {
                  const imgs = cs.filter((c) => c.imageUrl?.startsWith("file")).slice(0, 3);
                  return imgs.length > 0 ? (
                    <View style={s.collage}>
                      {imgs.map((c) => <ImgLoad key={c.id} uri={c.imageUrl!} style={s.collageImg} />)}
                    </View>
                  ) : null;
                })()}
                {isOpen && (
                  <View style={s.sheet}>
                    <Btn label="Practise this lesson" kind="marigold"
                      onPress={() => practiseLesson(l.id)} style={{ marginBottom: 12 }} />
                    {cs.map((c) => <ConceptCard key={c.id} id={c.id} />)}
                  </View>
                )}
              </View>
            );
          })}

          {mode === "lesson" && orphans.length > 0 && (
            <View style={s.lesson}>
              <TouchableOpacity style={s.lessonHead} onPress={() => setOpen(open === "orphans" ? null : "orphans")}>
                <View style={{ flex: 1 }}>
                  <Text style={s.lessonLabel}>Earlier material</Text>
                  <Text style={s.lessonMeta}>{orphans.length} concepts</Text>
                </View>
                <Text style={s.chev}>{open === "orphans" ? "▲" : "▼"}</Text>
              </TouchableOpacity>
              {open === "orphans" && (
                <View style={{ marginTop: 10 }}>
                  <Btn label="Practise this set" kind="marigold"
                    onPress={() => practiseLesson(null)} style={{ marginBottom: 12 }} />
                  {orphans.map((c) => <ConceptCard key={c.id} id={c.id} />)}
                </View>
              )}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, marginTop: 10 },
  searchInput: { flex: 1, fontSize: 14.5, color: C.ink, padding: 0 },
  note: { color: C.muted, fontSize: 13.5, lineHeight: 19 },
  shelfCard: {
    backgroundColor: C.purpleBg, borderRadius: 18, borderWidth: 1.5, borderColor: C.purple,
    borderStyle: "dashed", padding: 14, marginTop: 10, marginBottom: 20,
  },
  shelfHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  shelfBadge: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
  },
  shelfTitle: { fontSize: 15, fontWeight: "900", color: C.purple },
  shelfSub: { fontSize: 11.5, color: C.muted, marginTop: 1 },
  shelfCount: { backgroundColor: C.purple, borderRadius: 999, minWidth: 22, height: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  shelfCountText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  shelfChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, maxWidth: "100%" },
  shelfChipText: { fontSize: 13, fontWeight: "700", color: C.ink, maxWidth: 180 },
  emptyLib: { alignItems: "center", backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 22, padding: 26, marginTop: 8 },
  emptyLibTitle: { fontSize: 18, fontWeight: "800", color: C.ink, marginTop: 8 },
  emptyLibSub: { fontSize: 13, color: C.muted, textAlign: "center", marginTop: 6, lineHeight: 19 },
  masteryCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 14, marginBottom: 14 },
  masteryBar: { flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: C.line },
  masteryLegend: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  masteryLegendText: { fontSize: 12.5, fontWeight: "800" },
  stageBadge: { position: "absolute", top: 10, right: 10, backgroundColor: "rgba(255,255,255,0.92)", borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  stageBadgeText: { fontSize: 11, fontWeight: "800" },
  lessonBadge: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 10 },
  wrap: { padding: 18, paddingBottom: 40 },
  empty: { color: C.muted, fontSize: 14.5, lineHeight: 21, marginTop: 8, textAlign: "center" },
  emptyBox: { alignItems: "center", marginTop: 40, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 19, fontWeight: "700", color: C.ink, marginTop: 12 },
  histToggle: { fontSize: 13, fontWeight: "700", color: C.clay, marginTop: 12, marginBottom: 6 },
  modeRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  modePill: {
    borderWidth: 1.5, borderColor: C.line, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 7, backgroundColor: C.card,
  },
  modePillOn: { backgroundColor: C.purple, borderColor: C.purple },
  modePillText: { fontSize: 13, fontWeight: "700", color: C.muted },
  modePillTextOn: { color: "#fff" },
  histRow: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line,
    borderRadius: 14, padding: 12, marginBottom: 8,
  },
  histDate: { fontSize: 13.5, fontWeight: "700", color: C.ink },
  histMeta: { fontSize: 12.5, color: C.pineDeep, fontWeight: "600", marginTop: 2 },
  histConcepts: { fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 17 },
  lesson: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line,
    borderRadius: 18, padding: 15, marginTop: 12,
  },
  lessonHead: { flexDirection: "row", alignItems: "center" },
  lessonLabel: { fontSize: 16.5, fontWeight: "700", color: C.ink },
  lessonMeta: { fontSize: 12.5, color: C.muted, marginTop: 2 },
  chev: { fontSize: 14, color: C.muted, paddingLeft: 10 },
  title: { fontSize: 17, fontWeight: "600", color: C.ink },
  thumb: { width: "100%", height: 110, borderRadius: 12, marginBottom: 10 },
  cover: { width: "100%", height: 130 },
  collage: { flexDirection: "row", gap: 6, marginTop: 10 },
  collageImg: { flex: 1, height: 62, borderRadius: 10 },
  sheet: { backgroundColor: C.sage, borderRadius: 16, padding: 12, marginTop: 10 },
  summary: { fontSize: 13.5, color: C.muted, marginTop: 4, lineHeight: 19 },
  foot: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" },
  meta: { fontSize: 12, color: C.muted },
  quickGo: { fontSize: 12, fontWeight: "800", color: C.clay },
  mastery: { fontSize: 11.5, color: C.pineDeep, fontWeight: "700", letterSpacing: 1 },
});
