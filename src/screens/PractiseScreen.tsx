import React, { useEffect, useState } from "react";
import { LayoutAnimation, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, UIManager, View } from "react-native";
import * as Haptics from "expo-haptics";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { AppData, PendingSession, todayKey, daysFromNow } from "../types";
import { buildStudyPlan, weaveLessonPlan, foldFreshIntoPlan, sessionIdsForDay, dayCompletion } from "../planner";
import { saveData } from "../storage";
import { Btn, Card, Chip, Eyebrow, H1, catTone, lessonTone } from "../components/UI";
import { C } from "../theme";
import Confetti from "../components/Confetti";

const DAY_OPTIONS = [3, 5, 7, 10, 14]; // ONE set everywhere: first build AND per-lesson weaving

export default function PractiseScreen({ data, setData, go, startSession, lessonFocus }: {
  data: AppData; setData: (d: AppData) => void; go: (v: string) => void;
  startSession: (p: PendingSession) => void; lessonFocus?: { id: string } | null;
}) {
  const [daysCount, setDaysCount] = useState(7);
  const [startOpt, setStartOpt] = useState<"today" | "tomorrow" | "monday">("today");
  const [open, setOpen] = useState<string | null>(null);
  const [justBuilt, setJustBuilt] = useState(false);
  const [mode, setMode] = useState<"list" | "week" | "month">("list");
  const [selDate, setSelDate] = useState(todayKey());
  const [monthOff, setMonthOff] = useState(0);
  const [lessonFilter, setLessonFilter] = useState<string | null>(null);
  const [weaveDays, setWeaveDays] = useState<Record<string, number>>({});
  const [builtMsg, setBuiltMsg] = useState("Plan ready ✓ — first stop: today");
  useEffect(() => { if (lessonFocus) setLessonFilter(lessonFocus.id); }, [lessonFocus]);
  const toggle = (v: string | null) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(v);
  };
  const t = todayKey();
  const plan = data.studyPlan;
  const newCount = data.exercises.filter((e) => e.reps === 0).length;
  const plannedIds = new Set(plan?.days.flatMap((d) => d.exerciseIds) ?? []);
  const unplanned = plan ? data.exercises.filter((e) => e.reps === 0 && !plannedIds.has(e.id)) : [];
  const unplannedLessons = [...new Set(unplanned
    .map((e) => data.concepts.find((c) => c.id === e.conceptId)?.lessonId)
    .map((lid) => data.lessons.find((l) => l.id === lid)?.label)
    .filter(Boolean))] as string[];

  const lessonOfEx = (id: string) => {
    const e = data.exercises.find((k) => k.id === id);
    return e ? data.concepts.find((c) => c.id === e.conceptId)?.lessonId ?? null : null;
  };

  const planLesson = async (lid: string, nDays: number) => {
    const before = plan ?? { days: [] as { date: string; exerciseIds: string[] }[] };
    const sp = weaveLessonPlan(data, lid, nDays);
    if (!sp) return;
    const grew = sp.days
      .map((d) => ({ date: d.date, delta: d.exerciseIds.length - (before.days.find((x) => x.date === d.date)?.exerciseIds.length ?? 0) }))
      .filter((x) => x.delta > 0);
    const label = grew.slice(0, 3).map((x) => `${niceDate(x.date)} +${x.delta}`).join(" · ");
    setBuiltMsg(`Scheduled over ${grew.length} day${grew.length === 1 ? "" : "s"} ✓ — ${label}${grew.length > 3 ? " · …" : ""}`);
    const next = { ...data, studyPlan: sp };
    setData(next); await saveData(next);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setJustBuilt(true); setTimeout(() => setJustBuilt(false), 5200);
  };

  const foldLesson = async (lid: string) => {
    const sp = foldFreshIntoPlan(data, lid);
    if (!sp) return;
    setBuiltMsg("Fresh exercises slotted into this lesson's existing days ✓");
    const next = { ...data, studyPlan: sp };
    setData(next); await saveData(next);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setJustBuilt(true); setTimeout(() => setJustBuilt(false), 5200);
  };

  const startDateFor = () => {
    if (startOpt === "today") return t;
    if (startOpt === "tomorrow") return daysFromNow(1);
    const d = new Date();
    const add = (8 - d.getDay()) % 7 || 7;
    return daysFromNow(add);
  };

  const build = async () => {
    const sp = buildStudyPlan(data, daysCount, startDateFor());
    const next = { ...data, studyPlan: sp };
    setData(next); await saveData(next);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setJustBuilt(true); setTimeout(() => setJustBuilt(false), 2600);
  };

  const clearPlan = async () => {
    const next = { ...data, studyPlan: null, pending: null }; // fresh slate: resume hero goes too
    setData(next); await saveData(next);
  };

  const startDay = (dayDate: string) => {
    const day = plan?.days.find((d) => d.date === dayDate);
    if (!day) return;
    const ids = sessionIdsForDay(data, day);
    if (ids.length === 0) return;
    const pending: PendingSession = {
      ids, stepIdx: 0, results: [],
      style: data.settings.learningStyle ?? "quiz",
    };
    if (day.date === t) {
      const next = { ...data, pending };
      setData(next); saveData(next);
    }
    startSession(pending);
  };

  const niceDate = (iso: string) => {
    const d = new Date(iso);
    if (iso === t) return "Today";
    if (iso === daysFromNow(1)) return "Tomorrow";
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
  };

  /* ---------------- WIZARD ---------------- */
  if (!plan) {
    return (
      <ScrollView contentContainerStyle={s.wrap}>
        <Eyebrow>Your study calendar</Eyebrow>
        <H1>Build a plan</H1>
        {newCount === 0 ? (
          <Card style={{ marginTop: 16 }}>
            <Text style={s.note}>
              No new material to plan yet — add a lesson first, then come back
              here to spread it across your week.
            </Text>
            <Btn label="Add a lesson" kind="marigold" onPress={() => go("add")} style={{ marginTop: 12 }} />
          </Card>
        ) : (
          <>
            <Text style={s.sub}>
              You have <Text style={{ fontWeight: "700", color: C.pineDeep }}>{newCount} new exercises</Text> waiting.
              Tell me how to spread them out and I'll balance the topics across your days.
            </Text>

            <Text style={s.label}>Across how many days?</Text>
            <View style={s.pillRow}>
              {DAY_OPTIONS.map((d) => (
                <TouchableOpacity key={d} onPress={() => setDaysCount(d)}
                  style={[s.pill, daysCount === d && s.pillOn]}>
                  <Text style={[s.pillText, daysCount === d && s.pillTextOn]}>{d} days</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.hint}>
              ≈ {Math.max(3, Math.ceil(newCount / daysCount))} exercises a day + due reviews.
              Whole topics stay together, so days vary a little — each day card
              shows its exact count.
            </Text>

            <Text style={s.label}>Starting when?</Text>
            <View style={s.pillRow}>
              {([["today", "Today"], ["tomorrow", "Tomorrow"], ["monday", "Next Monday"]] as const).map(([v, lab]) => (
                <TouchableOpacity key={v} onPress={() => setStartOpt(v)}
                  style={[s.pill, startOpt === v && s.pillOn]}>
                  <Text style={[s.pillText, startOpt === v && s.pillTextOn]}>{lab}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Btn label="Build my plan 🗓" kind="marigold" onPress={build} style={{ marginTop: 20 }} />
            <Text style={s.hint}>
              Every day mixes grammar, vocabulary, pronunciation and phrases —
              and spaced-repetition reviews slot in automatically.
            </Text>
          </>
        )}
      </ScrollView>
    );
  }

  /* ---------------- CALENDAR ---------------- */
  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Eyebrow>Your study calendar</Eyebrow>
      <H1>The plan</H1>
      {justBuilt && (
        <View style={s.banner}><Text style={s.bannerText}>{builtMsg}</Text></View>
      )}
      <Text style={s.sub}>
        {plan.days.length} days · started {new Date(plan.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}
      </Text>

      {(() => {
        const allDone = plan.days.length > 0 && plan.days.every((d) => dayCompletion(data, d) >= 1);
        if (!allDone) return null;
        return (
          <View style={s.champCard}>
            <Confetti />
            <Text style={{ fontSize: 40 }}>🏆</Text>
            <Text style={s.champTitle}>Course complete!</Text>
            <Text style={s.champSub}>Every single day of this plan is done. Spaced reviews will keep it fresh — or add a new lesson for the next round.</Text>
          </View>
        );
      })()}

      {unplanned.length > 0 && (
        <View style={s.newBanner}>
          <Text style={s.newBannerText}>🆕 New material to schedule — pick a pace per lesson:</Text>
          {(() => {
            const byLesson = new Map<string, { exN: number; cids: Set<string> }>();
            for (const e of unplanned) {
              const lid = data.concepts.find((c) => c.id === e.conceptId)?.lessonId;
              if (!lid) continue;
              const cur = byLesson.get(lid) ?? { exN: 0, cids: new Set<string>() };
              cur.exN++; cur.cids.add(e.conceptId);
              byLesson.set(lid, cur);
            }
            return [...byLesson.entries()].map(([lid, g]) => {
              const sel = weaveDays[lid] ?? 5;
              const alreadyPlanned = plan.days.some((d) => d.exerciseIds.some((id) => lessonOfEx(id) === lid));
              if (alreadyPlanned) {
                /* recurring concepts in a new file refreshed this lesson —
                   don't re-open the day wizard (its partial concept count
                   read as "it missed my concepts"); just slot the extras in */
                return (
                  <View key={lid} style={s.weaveRow}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: lessonTone(lid).fg, marginRight: 7 }} />
                      <Text style={s.weaveLabel} numberOfLines={1}>{data.lessons.find((l) => l.id === lid)?.label ?? "Lesson"}</Text>
                      <Text style={s.weaveMeta}>  +{g.exN} fresh</Text>
                    </View>
                    <Text style={s.weaveHint}>Your new notes revisited {g.cids.size} concept{g.cids.size === 1 ? "" : "s"} from this lesson and added {g.exN} fresh exercise{g.exN === 1 ? "" : "s"}. The rest of the lesson is already scheduled.</Text>
                    <Btn label="Slot them into its days ✓" kind="marigold" onPress={() => foldLesson(lid)} style={{ marginTop: 8 }} />
                  </View>
                );
              }
              return (
                <View key={lid} style={s.weaveRow}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: lessonTone(lid).fg, marginRight: 7 }} />
                    <Text style={s.weaveLabel} numberOfLines={1}>{data.lessons.find((l) => l.id === lid)?.label ?? "Lesson"}</Text>
                    <Text style={s.weaveMeta}>  {g.cids.size} concepts</Text>
                  </View>
                  <View style={{ flexDirection: "row", marginTop: 8 }}>
                    {DAY_OPTIONS.map((d) => (
                      <TouchableOpacity key={d} onPress={() => setWeaveDays((w) => ({ ...w, [lid]: d }))}
                        style={[s.weaveChip, sel === d && { backgroundColor: lessonTone(lid).fg, borderColor: lessonTone(lid).fg }]}>
                        <Text style={[s.weaveChipText, sel === d && { color: "#fff" }]}>{d}d</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={s.weaveHint}>≈ {Math.ceil(g.cids.size / sel)} concept{Math.ceil(g.cids.size / sel) === 1 ? "" : "s"} a day</Text>
                  <Btn label={`Plan over ${sel} days 🗓`} kind="marigold" onPress={() => planLesson(lid, sel)} style={{ marginTop: 8 }} />
                </View>
              );
            });
          })()}
        </View>
      )}

      {(() => {
        const inPlanLessons = [...new Set(plan.days.flatMap((d) => d.exerciseIds).map(lessonOfEx).filter(Boolean))] as string[];
        if (inPlanLessons.length < 2) return null;
        return (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
            <TouchableOpacity onPress={() => setLessonFilter(null)} style={[s.lessChip, !lessonFilter && s.lessChipOn]}>
              <Text style={[s.lessChipText, !lessonFilter && s.lessChipTextOn]}>All lessons</Text>
            </TouchableOpacity>
            {inPlanLessons.map((lid) => {
              const les = data.lessons.find((l) => l.id === lid);
              const on = lessonFilter === lid;
              return (
                <TouchableOpacity key={lid} onPress={() => setLessonFilter(on ? null : lid)} style={[s.lessChip, on && { backgroundColor: lessonTone(lid).fg, borderColor: lessonTone(lid).fg }]}>
                  <Text style={[s.lessChipText, on && s.lessChipTextOn]}>📘 {les?.label ?? "Lesson"}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        );
      })()}

      <View style={s.seg}>
        {(["list", "week", "month"] as const).map((m) => (
          <TouchableOpacity key={m} onPress={() => { setMode(m); setSelDate(todayKey()); setMonthOff(0); }}
            style={[s.segBtn, mode === m && s.segOn]}>
            <Text style={[s.segText, mode === m && s.segTextOn]}>{m === "list" ? "☰ List" : m === "week" ? "▦ Week" : "▦ Month"}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === "week" && (() => {
        const base = new Date();
        const mon = new Date(base); mon.setDate(base.getDate() - ((base.getDay() + 6) % 7));
        return (
          <View style={s.weekRow}>
            {Array.from({ length: 7 }, (_, i) => {
              const d = new Date(mon); d.setDate(mon.getDate() + i);
              const iso = d.toISOString().slice(0, 10);
              const pd = plan.days.find((x) => x.date === iso);
              const dc = pd ? dayCompletion(data, pd) : -1;
              const sel = selDate === iso;
              return (
                <TouchableOpacity key={iso} onPress={() => setSelDate(iso)} style={[s.wkCell, sel && s.wkCellOn]}>
                  <Text style={[s.wkDay, sel && { color: "#fff" }]}>{d.toLocaleDateString("en-GB", { weekday: "narrow" })}</Text>
                  <Text style={[s.wkNum, sel && { color: "#fff" }]}>{d.getDate()}</Text>
                  <View style={[s.dot, { backgroundColor: dc < 0 ? "transparent" : dc >= 1 ? C.pine : dc > 0 ? C.clay : C.line }]} />
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })()}

      {mode === "month" && (() => {
        const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + monthOff);
        const y = base.getFullYear(), mo = base.getMonth();
        const firstWd = (new Date(y, mo, 1).getDay() + 6) % 7; // Monday-first
        const dim = new Date(y, mo + 1, 0).getDate();
        const pad2 = (n: number) => String(n).padStart(2, "0");
        return (
          <View style={{ marginTop: 4 }}>
            <View style={s.monthHead}>
              <TouchableOpacity onPress={() => setMonthOff((v) => v - 1)} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}><Text style={s.monthArrow}>‹</Text></TouchableOpacity>
              <Text style={s.monthTitle}>{base.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</Text>
              <TouchableOpacity onPress={() => setMonthOff((v) => v + 1)} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}><Text style={s.monthArrow}>›</Text></TouchableOpacity>
            </View>
            <View style={s.monthGrid}>
              {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
                <View key={w + i} style={s.mCell}><Text style={s.mWd}>{w}</Text></View>
              ))}
              {Array.from({ length: firstWd }, (_, i) => <View key={"b" + i} style={s.mCell} />)}
              {Array.from({ length: dim }, (_, i) => {
                const iso = `${y}-${pad2(mo + 1)}-${pad2(i + 1)}`;
                const pd = plan.days.find((x) => x.date === iso);
                const dc = pd ? dayCompletion(data, pd) : -1;
                const sel = selDate === iso;
                return (
                  <TouchableOpacity key={iso} onPress={() => setSelDate(iso)} style={[s.mCell, sel && s.mCellOn, iso === t && s.mCellToday]}>
                    <Text style={[s.mNum, sel && { color: "#fff" }]}>{i + 1}</Text>
                    <View style={[s.dot, { backgroundColor: dc < 0 ? "transparent" : dc >= 1 ? C.pine : dc > 0 ? C.clay : C.line }]} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })()}

      {mode !== "list" && !plan.days.some((d) => d.date === selDate) && (
        <Card style={{ marginTop: 12 }}><Text style={s.note}>Nothing planned for {selDate === t ? "today" : "this day"} — a rest day. 🌿</Text></Card>
      )}

      {(mode === "list" ? plan.days : plan.days.filter((d) => d.date === selDate)).map((day, di) => {
        const exIds = lessonFilter ? day.exerciseIds.filter((id) => lessonOfEx(id) === lessonFilter) : day.exerciseIds;
        if (lessonFilter && exIds.length === 0) return null;
        const done = exIds.length
          ? exIds.filter((id) => (data.exercises.find((e) => e.id === id)?.reps ?? 0) > 0).length / exIds.length
          : dayCompletion(data, day);
        const isPast = day.date < t, isToday = day.date === t;
        const isOpen = open === day.date;
        const dayCids = new Set(exIds.map((id) => data.exercises.find((e) => e.id === id)?.conceptId));
        const concepts = day.conceptIds
          .filter((id) => !lessonFilter || dayCids.has(id))
          .map((id) => data.concepts.find((c) => c.id === id))
          .filter(Boolean) as NonNullable<ReturnType<typeof data.concepts.find>>[];
        const cats = [...new Set(concepts.map((c) => c.category))];
        const dayLessons = [...new Set(concepts.map((c) => data.lessons.find((l) => l.id === c.lessonId)?.label).filter(Boolean))] as string[];
        return (
          <React.Fragment key={day.date}>
          {di > 0 && <View style={s.connector} />}
          <View style={[s.day, isToday && s.dayToday]}>
            <TouchableOpacity style={s.dayHead} onPress={() => toggle(isOpen ? null : day.date)}>
              <View style={[s.dayStatus, done >= 1 ? s.stDone : isToday ? s.stToday : isPast ? s.stMissed : s.stFuture]}>
                <Text style={s.dayStatusText}>{done >= 1 ? "✓" : isToday ? "●" : ""}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.dayDate}>{niceDate(day.date)}</Text>
                <Text style={s.dayMeta}>
                  {concepts.slice(0, 3).map((c) => c.emoji || "📘").join(" ")}{" "}
                  {exIds.length} exercises · {cats.join(" · ")}
                  {done > 0 && done < 1 ? ` · ${Math.round(done * 100)}% done` : ""}
                </Text>
                {dayLessons.length > 0 && (
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
                    {concepts.slice(0, 6).reduce((acc: string[], c) => (c.lessonId && !acc.includes(c.lessonId) ? [...acc, c.lessonId] : acc), []).map((lid) => (
                      <View key={lid} style={{ flexDirection: "row", alignItems: "center", marginRight: 10 }}>
                        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: lessonTone(lid).fg, marginRight: 4 }} />
                        <Text style={s.dayLessons}>{data.lessons.find((l) => l.id === lid)?.label ?? "Lesson"}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {done > 0 && (
                  <View style={{ height: 5, borderRadius: 3, backgroundColor: C.line, marginTop: 6, overflow: "hidden" }}>
                    <View style={{ height: 5, borderRadius: 3, width: `${Math.round(done * 100)}%`, backgroundColor: done >= 1 ? C.pine : C.clay }} />
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={() => startDay(day.date)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.quickPlay}>▶</Text>
              </TouchableOpacity>
              <Text style={s.chev}>{isOpen ? "▲" : "▼"}</Text>
            </TouchableOpacity>
            {isOpen && (
              <View style={s.sheet}>
                {(() => {
                  const byLesson = new Map<string, { done: number; total: number }>();
                  for (const id of day.exerciseIds) {
                    const e = data.exercises.find((k) => k.id === id); if (!e) continue;
                    const lid = data.concepts.find((k) => k.id === e.conceptId)?.lessonId ?? "?";
                    const cur = byLesson.get(lid) ?? { done: 0, total: 0 };
                    cur.total++; if (e.reps > 0) cur.done++;
                    byLesson.set(lid, cur);
                  }
                  if (byLesson.size < 2) return null;
                  return (
                    <View style={{ marginBottom: 8 }}>
                      {[...byLesson.entries()].map(([lid, v]) => (
                        <Text key={lid} style={s.lessonLine}>📘 {data.lessons.find((l) => l.id === lid)?.label ?? "Lesson"} — {v.done}/{v.total}</Text>
                      ))}
                    </View>
                  );
                })()}
                {concepts.map((c) => (
                  <View key={c.id} style={s.conceptRow}>
                    <Text style={{ fontSize: 16 }}>{c.emoji || "📘"}</Text>
                    <Text style={s.conceptTitle}>{c.title}</Text>
                    <Chip tone={catTone(c.category)}>{c.category}</Chip>
                  </View>
                ))}
                <Btn
                  label={done >= 1 ? "Practise again" : isToday ? "Start today's session" : isPast ? "Catch up" : "Start early"}
                  kind="marigold" onPress={() => startDay(day.date)} style={{ marginTop: 10 }}
                />
              </View>
            )}
          </View>
          </React.Fragment>
        );
      })}

      <TouchableOpacity onPress={clearPlan}>
        <Text style={s.rebuild}>Scrap this plan & build a new one</Text>
      </TouchableOpacity>
      <Text style={s.hint}>
        Each lesson you add can be woven into this plan from the banner above —
        days already done stay exactly as they are.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  weaveRow: { marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10 },
  weaveLabel: { fontSize: 14, fontWeight: "800", color: C.ink, maxWidth: 180 },
  weaveMeta: { fontSize: 12, color: C.muted },
  weaveChip: { flex: 1, alignItems: "center", borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingVertical: 7, marginRight: 6, backgroundColor: C.card },
  weaveHint: { fontSize: 12, color: C.muted, marginTop: 6 },
  weaveChipText: { fontSize: 12.5, fontWeight: "800", color: C.ink },
  champCard: { alignItems: "center", backgroundColor: C.sage, borderColor: C.pine, borderWidth: 1.5, borderRadius: 20, padding: 20, marginTop: 12, overflow: "hidden" },
  champTitle: { fontSize: 20, fontWeight: "900", color: C.pineDeep, marginTop: 6 },
  champSub: { fontSize: 13, color: C.muted, textAlign: "center", marginTop: 6, lineHeight: 19 },
  lessChip: { borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, marginRight: 8, backgroundColor: C.card },
  lessChipOn: { backgroundColor: C.purple, borderColor: C.purple },
  lessChipText: { fontSize: 12.5, fontWeight: "700", color: C.ink },
  lessChipTextOn: { color: "#fff" },
  dayLessons: { fontSize: 11.5, fontWeight: "700", color: C.muted },
  newBanner: { backgroundColor: C.amberBg, borderColor: C.clay, borderWidth: 1.5, borderRadius: 16, padding: 14, marginTop: 12 },
  newBannerText: { fontSize: 13.5, color: C.ink, fontWeight: "600", lineHeight: 19 },
  seg: { flexDirection: "row", backgroundColor: C.line, borderRadius: 12, padding: 3, marginTop: 14, marginBottom: 10 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  segOn: { backgroundColor: C.card },
  segText: { fontSize: 12.5, fontWeight: "700", color: C.muted },
  segTextOn: { color: C.pineDeep },
  weekRow: { flexDirection: "row", gap: 5, marginBottom: 10 },
  wkCell: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  wkCellOn: { backgroundColor: C.pine, borderColor: C.pine },
  wkDay: { fontSize: 10.5, fontWeight: "700", color: C.muted },
  wkNum: { fontSize: 15, fontWeight: "800", color: C.ink, marginTop: 1 },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 4 },
  monthHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 6, marginBottom: 6 },
  monthTitle: { fontSize: 15, fontWeight: "800", color: C.ink },
  monthArrow: { fontSize: 24, fontWeight: "800", color: C.pine, paddingHorizontal: 8 },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 10 },
  mCell: { width: `${100 / 7}%`, alignItems: "center", paddingVertical: 6, borderRadius: 10 },
  mCellOn: { backgroundColor: C.pine },
  mCellToday: { borderWidth: 1.5, borderColor: C.clay },
  mWd: { fontSize: 10.5, fontWeight: "800", color: C.muted },
  mNum: { fontSize: 13.5, fontWeight: "700", color: C.ink },
  lessonLine: { fontSize: 12.5, fontWeight: "700", color: C.pineDeep, marginBottom: 3 },
  wrap: { padding: 18, paddingBottom: 40 },
  sub: { color: C.muted, fontSize: 14.5, lineHeight: 21, marginTop: 4 },
  note: { fontSize: 13.5, color: C.muted, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: "700", color: C.ink, marginTop: 20, marginBottom: 8 },
  hint: { fontSize: 12.5, color: C.muted, marginTop: 10, lineHeight: 18 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    borderWidth: 1.5, borderColor: C.line, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.card,
  },
  pillOn: { backgroundColor: C.pine, borderColor: C.pine },
  pillText: { fontSize: 14, fontWeight: "700", color: C.muted },
  pillTextOn: { color: "#fff" },
  day: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line,
    borderRadius: 18, padding: 14, marginTop: 12,
  },
  dayToday: { borderColor: C.clay, borderWidth: 2 },
  dayHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  dayStatus: {
    width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center",
  },
  stDone: { backgroundColor: C.pine },
  stToday: { backgroundColor: C.clay },
  stMissed: { backgroundColor: C.roseBg },
  stFuture: { backgroundColor: C.line },
  dayStatusText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  dayDate: { fontSize: 15.5, fontWeight: "700", color: C.ink },
  dayMeta: { fontSize: 12, color: C.muted, marginTop: 2 },
  quickPlay: { fontSize: 16, color: C.clay, fontWeight: "800", paddingHorizontal: 6 },
  chev: { fontSize: 13, color: C.muted, paddingLeft: 8 },
  conceptRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" },
  conceptTitle: { flex: 1, fontSize: 14, fontWeight: "600", color: C.ink },
  rebuild: { fontSize: 13, color: C.clay, fontWeight: "700", textAlign: "center", marginTop: 20 },
  banner: { backgroundColor: C.sage, borderRadius: 12, padding: 12, marginTop: 10 },
  sheet: { backgroundColor: C.sage, borderRadius: 16, padding: 12, marginTop: 12 },
  connector: { width: 3, height: 16, backgroundColor: C.line, marginLeft: 28, borderRadius: 2 },
  bannerText: { color: C.pineDeep, fontWeight: "700", fontSize: 13.5, textAlign: "center" },
});
