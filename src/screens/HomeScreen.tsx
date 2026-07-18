import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import { Animated, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AppData, PendingSession, levelFor, levelTitle, nextLevelAt, todayKey, LEVELS } from "../types";
import { buildPlan, sessionIdsForDay, dayCompletion } from "../planner";
import { fetchImageFor } from "../images";

import { saveData } from "../storage";
import { Btn, Card, Eyebrow, FadeIn, Mascot, lessonTone } from "../components/UI";
import { C } from "../theme";

const TIPS = [
  "Little and often beats a lot and rarely — ten minutes will do nicely.",
  "Say your answers out loud. Your mouth remembers better than your eyes.",
  "A wrong answer today is a right answer next week. Carry on.",
  "Revising before bed helps the memory settle overnight. Sleep on it, quite literally.",
  "Struggling to recall is the workout. If it were easy, it wouldn't stick.",
  "Consistency looks boring and works brilliantly.",
  "One combo streak a day keeps the forgetting curve away.",
];

function AnimatedFill({ pct }: { pct: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(v, { toValue: pct, duration: 700, useNativeDriver: false }).start(); }, [pct]);
  return <Animated.View style={{ height: "100%", borderRadius: 6, backgroundColor: "#E8A33D",
    width: v.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }) }} />;
}

function PulseFlame() {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1.25, duration: 600, useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]));
    loop.start(); return () => loop.stop();
  }, []);
  return <Animated.Text style={{ fontSize: 18, transform: [{ scale: v }] }}>🔥</Animated.Text>;
}

export default function HomeScreen({ data, setData, go, startSession, openLesson }: {
  data: AppData; setData: (d: AppData) => void; go: (v: string) => void; openLesson: (id: string) => void;
  startSession: (p: PendingSession) => void;
}) {
  const { items } = useMemo(() => buildPlan(data), [data]);
  const t = todayKey();
  const todayLog = data.sessions.find((s) => s.date === t);
  const doneToday = !!todayLog;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning 🌅" : hour < 18 ? "Good afternoon ☀️" : "Good evening 🌙";
  const heroColours = hour >= 18
    ? ["#123B2A", "#0B2E1F", "#071F14"]       // calmer evening tones
    : ["#0E6B3D", "#0B5C33", "#084425"];
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    const missing = data.concepts.filter((c) => c.imageQuery && !c.imageUrl).slice(0, 5);
    for (const c of missing) {
      const url = await fetchImageFor(c);
      if (url) {
        const next = { ...data, concepts: data.concepts.map((k) => (k.id === c.id ? { ...k, imageUrl: url } : k)) };
        setData(next);
      }
    }
    setRefreshing(false);
  };
  const tip = TIPS[new Date().getDate() % TIPS.length];
  const level = levelFor(data.xp);
  const [showLevels, setShowLevels] = useState(false);
  const [showHeat, setShowHeat] = useState(false);
  const [chestMsg, setChestMsg] = useState<string | null>(null);

  const openChest = async () => {
    if (data.lastChest === t) return;
    const winFreeze = Math.random() < 0.1;
    const bonus = 5 + Math.floor(Math.random() * 11);
    const next = { ...data, lastChest: t, xp: data.xp + (winFreeze ? 0 : bonus), freezes: data.freezes + (winFreeze ? 1 : 0) };
    setData(next); await saveData(next);
    setChestMsg(winFreeze ? "❄️ A streak freeze! Rare find." : `✨ +${bonus} bonus XP!`);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };
  const latest = [...data.lessons].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const recurring = data.concepts.filter((c) => c.seenCount > 1).slice(0, 3);
  /* The goal card mirrors TODAY'S plan day only — a session you started for
     another day never hijacks it. Other days live in the Plan tab. */
  const planToday = data.studyPlan?.days.find((d) => d.date === t);
  let goalPct: number, goalDone: number, goalTotal: number;
  if (planToday) {
    /* "done" = graded TODAY (lastGraded), never "ever attempted" (reps>0) —
       a due review from last week folded into today's plan must NOT already
       read as complete the instant it appears. Shelved concepts are parked
       by the user on purpose, so they don't count toward today's target. */
    const relevantIds = planToday.exerciseIds.filter((id) => {
      const e = data.exercises.find((k) => k.id === id);
      return e && !data.concepts.find((c) => c.id === e.conceptId)?.shelved;
    });
    goalTotal = relevantIds.length;
    const doneExs = relevantIds.filter((id) => data.exercises.find((k) => k.id === id)?.lastGraded === t).length;
    goalDone = doneExs;
    goalPct = goalTotal ? Math.min(100, Math.round((100 * doneExs) / goalTotal)) : 0;
  } else if (data.studyPlan && data.studyPlan.days.length > 0) {
    // fresh plan starting later: yesterday's log must NOT masquerade as today's progress
    const upcoming = data.studyPlan.days.find((d) => d.date > t);
    goalTotal = upcoming?.exerciseIds.length ?? 0;
    goalDone = 0;
    goalPct = 0;
  } else {
    // no plan at all: a scrapped plan means a fresh slate — count what's DUE,
    // never resurrect this morning's session log as "progress"
    goalTotal = items.length;
    goalDone = 0;
    goalPct = items.length === 0 ? 100 : 0;
  }

  const remaining = data.pending
    ? data.pending.ids.filter((id) => !data.pending!.results.some((r) => r.exId === id)).length
    : 0;
  const newCount = data.exercises.filter((e) => e.reps === 0).length;
  const plannedIds = new Set(data.studyPlan?.days.flatMap((d) => d.exerciseIds) ?? []);
  const unplannedCount = data.studyPlan ? data.exercises.filter((e) => e.reps === 0 && !plannedIds.has(e.id)).length : 0;

  const begin = () => {
    const planDay = data.studyPlan?.days.find((d) => d.date === t);
    const ids = planDay ? sessionIdsForDay(data, planDay) : items.map((e) => e.id);
    const pending: PendingSession = {
      ids, stepIdx: 0, results: [],
      style: data.settings.learningStyle ?? "quiz",
    };
    const next = { ...data, pending };
    setData(next); saveData(next);
    startSession(pending);
  };

  const last7 = [...Array(7)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    const log = data.sessions.find((s) => s.date === key);
    return { day: d.toLocaleDateString("en-GB", { weekday: "narrow" }), done: log?.done ?? 0 };
  });

  return (
    <ScrollView contentContainerStyle={s.wrap}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.pine} />}>
      <Eyebrow>{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</Eyebrow>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={s.greeting}>{greeting}</Text>
        {data.streak.count > 2 && <PulseFlame />}
      </View>

      {data.pending && (
        <TouchableOpacity activeOpacity={0.85} onPress={() => startSession(data.pending!)} style={s.resumeHero}>
          <Text style={s.resumeHeroTitle}>▶  Continue your session</Text>
          <Text style={s.resumeHeroSub}>{remaining > 0 ? `${remaining} question${remaining === 1 ? "" : "s"} left — pick up right where you stopped` : "Just the speed round ⚡ left — 45 seconds of glory"}</Text>
          <View style={s.resumeBar}>
            <View style={[s.resumeBarFill, { width: `${Math.round((100 * (data.pending.ids.length - remaining)) / Math.max(1, data.pending.ids.length))}%` }]} />
          </View>
        </TouchableOpacity>
      )}

      {data.lessons.length === 0 && data.concepts.length === 0 && (
        <View style={s.emptyCard}>
          <Text style={{ fontSize: 44 }}>🌱</Text>
          <Text style={s.emptyTitle}>Plant your first lesson</Text>
          <Text style={s.emptySub}>Paste your coach's notes or a PDF — Swotly turns them into a revision plan, quizzes and pictures.</Text>
          <Btn label="Add your notes" kind="marigold" onPress={() => go("add")} style={{ marginTop: 14, alignSelf: "stretch" }} />
        </View>
      )}

      {/* Winston */}
      {data.exercises.length === 0 ? (
        <Card style={{ marginTop: 16 }}>
          <Text style={s.cardTitle}>Let's get your first notes in</Text>
          <Text style={s.note}>Paste, pick a PDF, or photograph your lesson — I'll do the rest.</Text>
          <Btn label="Add your notes" kind="marigold" onPress={() => go("add")} style={{ marginTop: 12 }} />
        </Card>
      ) : (
        <>
          {/* daily goal */}
          <FadeIn delay={0}>
          <LinearGradient colors={heroColours as any}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.goalCard}>
            <View style={s.goalHead}>
              <Text style={s.goalTitle}>{goalPct >= 100 && !data.pending ? "Today: done ✓" : "Today's goal"}</Text>
              <Text style={s.goalPct}>{goalPct}%</Text>
            </View>
            <View style={s.goalBar}><AnimatedFill pct={goalPct} /></View>
            <Text style={s.goalMeta}>
              {goalDone} / {goalTotal} exercises{planToday ? " · today's plan" : data.studyPlan ? ` · plan starts ${new Date(data.studyPlan.days.find((d) => d.date > t)?.date ?? t).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : " · review mix"}
            </Text>
            {(() => {
              const nextIds = planToday ? sessionIdsForDay(data, planToday) : items.map((e) => e.id);
              const firstEx = data.exercises.find((e) => e.id === nextIds[0] && e.reps === 0) ||
                data.exercises.find((e) => e.id === nextIds[0]);
              const c = firstEx && data.concepts.find((k) => k.id === firstEx.conceptId);
              return c && goalPct < 100 ? (
                <Text style={s.upNext}>Up next: {c.emoji || "📘"} {c.title}</Text>
              ) : null;
            })()}
            {data.studyPlan && (
              <Text style={s.goalLink} onPress={() => go("practise")}>Other days → full calendar</Text>
            )}
            {data.pending ? null : unplannedCount > 0 ? (
              <Btn label={`Add new lesson to plan 🗓 (${unplannedCount})`} kind="marigold"
                onPress={() => go("practise")} style={{ marginTop: 12 }} />
            ) : !data.studyPlan && newCount > 0 ? (
              <Btn label="Plan my days 🗓" kind="marigold"
                onPress={() => go("practise")} style={{ marginTop: 12 }} />
            ) : (
              <Btn
                label={goalPct >= 100 ? "Practise again" : planToday ? "Continue today's plan" : doneToday ? "Practise again" : "Review due cards"}
                kind="marigold" disabled={items.length === 0 && !planToday}
                onPress={begin} style={{ marginTop: 12 }} />
            )}
          </LinearGradient>
          </FadeIn>

          {/* stats */}
          {goalPct >= 100 && (data.lastChest !== t || chestMsg) && (
            <TouchableOpacity activeOpacity={0.85} onPress={openChest} style={s.chest}>
              <Text style={{ fontSize: 30 }}>{chestMsg ? "🎉" : "🎁"}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.chestTitle}>{chestMsg ?? "Goal complete — a little something for you"}</Text>
                <Text style={s.chestSub}>{chestMsg ? "See you at tomorrow's chest." : "Tap to open today's chest"}</Text>
              </View>
            </TouchableOpacity>
          )}

          <View style={s.statRow}>
            <TouchableOpacity onPress={() => setShowHeat((v) => !v)} style={{ flex: 1 }}>
              <Stat n={`${data.streak.count} ${showHeat ? "▾" : "▸"}`} l={"day streak" + (data.streak.count > 2 ? " 🔥" : "") + (data.freezes > 0 ? ` · ❄️×${data.freezes}` : "")} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowLevels((v) => !v)} style={{ flex: 1 }}>
              <Stat n={`Lv ${level} ${showLevels ? "▾" : "▸"}`} l={levelTitle(data.xp)} />
            </TouchableOpacity>
            <Stat n={`${data.xp}`} l={`XP · next ${nextLevelAt(data.xp)}`} />
          </View>
          {showHeat && (() => {
            const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            const parseKey = (k: string) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
            const today = new Date();
            const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
            /* start from the week of the very first logged session, not a fixed
               "last 4 weeks" — otherwise a brand-new user sees mostly empty,
               meaningless weeks before they'd even opened the app. Capped at
               8 weeks so a long-time user doesn't get an ever-growing list. */
            const firstDate = data.sessions.reduce((min, x) => (x.date < min ? x.date : min), t);
            const firstMonday = parseKey(firstDate);
            firstMonday.setDate(firstMonday.getDate() - ((firstMonday.getDay() + 6) % 7));
            const weeks = Math.max(1, Math.min(8, Math.round((monday.getTime() - firstMonday.getTime()) / (7 * 86400000)) + 1));
            return (
              <View style={s.levelPanel}>
                <Text style={s.heatTitle}>{weeks === 1 ? "This week" : `Last ${weeks} weeks`}</Text>
                <View style={s.heatRow}>
                  <Text style={s.heatWeekLabel}> </Text>
                  {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
                    <Text key={w + i} style={s.heatDayLetter}>{w}</Text>
                  ))}
                </View>
                {[...Array(weeks)].map((_, i) => weeks - 1 - i).map((back) => {
                  const start = new Date(monday); start.setDate(monday.getDate() - back * 7);
                  return (
                    <View key={back} style={s.heatRow}>
                      <Text style={s.heatWeekLabel}>{start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</Text>
                      {[...Array(7)].map((_, i) => {
                        const d = new Date(start); d.setDate(start.getDate() + i);
                        const k = iso(d);
                        const future = k > t;
                        const active = !future && data.sessions.some((x) => x.date === k && x.done > 0);
                        return <View key={k} style={[s.heatDot, future && s.heatDotFuture, active && s.heatDotOn, k === t && s.heatDotToday]} />;
                      })}
                    </View>
                  );
                })}
                <Text style={s.note}>Each square is a day — green means you showed up. Gaps are human, streaks are earned. 🔥</Text>
              </View>
            );
          })()}

          {showLevels && (
            <View style={s.levelPanel}>
              {LEVELS.map((req, i) => {
                const lv = i + 1; const here = lv === level; const locked = data.xp < req;
                return (
                  <View key={req} style={[s.levelRow, here && s.levelRowOn]}>
                    <Text style={[s.levelRowText, here && { color: "#fff" }]}>{locked ? "🔒" : here ? "📍" : "✓"}  Lv {lv} · {levelTitle(req)}</Text>
                    <Text style={[s.levelRowXp, here && { color: "#fff" }]}>{req} XP</Text>
                  </View>
                );
              })}
              <Text style={s.note}>Every answer feeds your level — {nextLevelAt(data.xp) - data.xp} XP to the next one.</Text>
            </View>
          )}

          {/* week strip */}
          <FadeIn delay={140}>
          {(() => {
            const log = todayLog;
            // deterministic per-day pick — same 3 quests all day, different tomorrow
            let dayHash = 0;
            for (let i = 0; i < t.length; i++) dayHash = (dayHash * 31 + t.charCodeAt(i)) | 0;
            dayHash = Math.abs(dayHash);
            const activeLessons = data.lessons.filter((l) => data.concepts.some((c) => c.lessonId === l.id && !c.shelved));
            const featured = activeLessons.length ? activeLessons[dayHash % activeLessons.length] : null;
            const featuredTitles = featured ? new Set(data.concepts.filter((c) => c.lessonId === featured.id).map((c) => c.title)) : null;
            const xpTarget = 40 + (dayHash % 4) * 10; // 40/50/60/70 — a real chunk of a session, not the first 4 questions
            const base = [
              { done: !!log && log.done > 0, text: "Complete a session" },
              { done: !!log && log.done > 0 && (100 * log.correct) / log.done >= 70, text: "Score 70% or better" },
            ];
            const rotating = [
              { done: (log?.xp ?? 0) >= xpTarget, text: `Earn ${xpTarget} XP` },
              { done: (log?.concepts.length ?? 0) >= 3, text: "Touch 3 different concepts" },
              { done: (log?.minutes ?? 0) >= 5, text: "Study for 5 minutes" },
              ...(featured ? [{ done: !!log?.concepts.some((ti) => featuredTitles!.has(ti)), text: `Practise something from "${featured.label}"` }] : []),
            ];
            const quests = [...base, rotating[dayHash % rotating.length]];
            const all = quests.every((q) => q.done);
            return (
              <Card style={[{ marginTop: 14 }, all && { borderColor: "#E8A33D", borderWidth: 2 }] as any}>
                <Eyebrow>Daily quests</Eyebrow>
                {quests.map((q, i) => <Quest key={i} done={q.done} text={q.text} />)}
                {all && <Text style={s.questAll}>All quests complete — cracking day! 🎉</Text>}
              </Card>
            );
          })()}
          </FadeIn>

          {data.lessons.length > 0 && (
            <FadeIn delay={200}>
            <Card style={{ marginTop: 14 }}>
              <Eyebrow>Your lessons</Eyebrow>
              {[...data.lessons].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5).map((l) => {
                const cids = new Set(data.concepts.filter((c) => c.lessonId === l.id).map((c) => c.id));
                const exs = data.exercises.filter((e) => cids.has(e.conceptId));
                if (exs.length === 0) return null;
                const doneN = exs.filter((e) => e.reps > 0).length;
                const pct = Math.round((100 * doneN) / exs.length);
                const outside = exs.filter((e) => e.reps === 0 && !plannedIds.has(e.id)).length;
                return (
                  <TouchableOpacity key={l.id} onPress={() => openLesson(l.id)} style={s.lessonProgRow}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", flex: 1, marginRight: 8 }}>
                        <View style={[s.lessonDot, { backgroundColor: lessonTone(l.id).fg }]} />
                        <Text style={s.lessonProgLabel} numberOfLines={1}>{l.label}</Text>
                      </View>
                      <Text style={s.lessonProgPct}>{pct}%</Text>
                    </View>
                    <View style={s.lessonProgBar}>
                      <View style={[s.lessonProgFill, { width: `${pct}%`, backgroundColor: pct >= 100 ? C.pine : lessonTone(l.id).fg }]} />
                    </View>
                    <Text style={s.lessonProgMeta}>{doneN}/{exs.length} exercises{outside > 0 ? ` · ${outside} not planned yet` : ""}</Text>
                  </TouchableOpacity>
                );
              })}
            </Card>
            </FadeIn>
          )}

        </>
      )}
    </ScrollView>
  );
}

const Quest = ({ done, text }: { done: boolean; text: string }) => (
  <View style={s.quest}>
    <Text style={[s.questTick, done && s.questTickOn]}>{done ? "✓" : "○"}</Text>
    <Text style={[s.questText, done && { color: C.pineDeep, textDecorationLine: "line-through" }]}>{text}</Text>
  </View>
);

const Stat = ({ n, l }: { n: string; l: string }) => (
  <View style={s.stat}>
    <Text style={s.statN}>{n}</Text>
    <Text style={s.statL}>{l}</Text>
  </View>
);

const s = StyleSheet.create({
  lessonDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  chest: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.purpleBg, borderColor: C.purple, borderWidth: 1.5, borderRadius: 18, padding: 14, marginTop: 14 },
  chestTitle: { fontSize: 14.5, fontWeight: "800", color: C.purple },
  chestSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  heatTitle: { fontSize: 13, fontWeight: "800", color: C.ink, marginBottom: 8 },
  heatRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  heatWeekLabel: { width: 44, fontSize: 10, color: C.muted, fontWeight: "700" },
  heatDayLetter: { width: 22, fontSize: 10, color: C.muted, fontWeight: "800", textAlign: "center" },
  heatDot: { width: 22, height: 15, borderRadius: 5, backgroundColor: C.line },
  heatDotFuture: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.line },
  heatDotOn: { backgroundColor: C.pine },
  heatDotToday: { borderWidth: 1.5, borderColor: C.clay },
  lessonProgRow: { marginTop: 12 },
  lessonProgLabel: { fontSize: 14, fontWeight: "800", color: C.ink, flex: 1, marginRight: 8 },
  lessonProgPct: { fontSize: 13, fontWeight: "900", color: C.pineDeep },
  lessonProgBar: { height: 7, borderRadius: 4, backgroundColor: C.line, marginTop: 6, overflow: "hidden" },
  lessonProgFill: { height: 7, borderRadius: 4, backgroundColor: C.clay },
  lessonProgMeta: { fontSize: 12, color: C.muted, marginTop: 4 },
  wrap: { padding: 18, paddingBottom: 40 },
  resumeHero: { backgroundColor: C.clay, borderRadius: 20, padding: 16, marginTop: 14 },
  resumeHeroTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },
  resumeHeroSub: { color: C.clayInk, fontSize: 13, marginTop: 4 },
  resumeBar: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.3)", marginTop: 12, overflow: "hidden" },
  resumeBarFill: { height: 6, borderRadius: 3, backgroundColor: "#fff" },
  emptyCard: { alignItems: "center", backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 22, padding: 24, marginTop: 16 },
  emptyTitle: { fontSize: 19, fontWeight: "800", color: C.ink, marginTop: 8 },
  emptySub: { fontSize: 13.5, color: C.muted, textAlign: "center", marginTop: 6, lineHeight: 19 },
  levelPanel: { marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10 },
  levelRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10 },
  levelRowOn: { backgroundColor: C.purple },
  levelRowText: { fontSize: 13.5, fontWeight: "700", color: C.ink },
  levelRowXp: { fontSize: 12.5, fontWeight: "700", color: C.muted },
  lvlRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  lvlText: { fontSize: 12, fontWeight: "800", color: C.purple },
  lvlBar: { flex: 1, height: 6, backgroundColor: C.line, borderRadius: 3, overflow: "hidden" },
  lvlFill: { height: "100%", backgroundColor: C.purple, borderRadius: 3 },
  lvlPts: { fontSize: 11, color: C.muted, fontWeight: "700" },
  nudge: { backgroundColor: "#1E2B3A", borderRadius: 12, padding: 11, marginTop: 10 },
  nudgeText: { color: "#CBD8EA", fontSize: 13, fontWeight: "600", textAlign: "center" },
  greeting: { fontSize: 28, fontWeight: "700", color: C.ink, marginTop: 4 },
  owlRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 14 },
  owl: { fontSize: 34 },
  bubble: {
    flex: 1, backgroundColor: C.purpleBg, borderRadius: 16, borderTopLeftRadius: 4, padding: 12,
  },
  bubbleName: { fontSize: 9.5, letterSpacing: 1.2, color: C.purple, fontWeight: "800", marginBottom: 3 },
  bubbleText: { fontSize: 13.5, color: C.purple, lineHeight: 19, fontWeight: "500" },
  cardTitle: { fontSize: 19, fontWeight: "600", color: C.ink },
  note: { fontSize: 13.5, color: C.muted, lineHeight: 20, marginTop: 6 },
  goalCard: { backgroundColor: C.pine, borderRadius: 22, padding: 20, marginTop: 16 },
  goalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  goalTitle: { color: "#F2F7F1", fontSize: 17, fontWeight: "700" },
  goalPct: { color: "#F2F7F1", fontSize: 17, fontWeight: "700" },
  goalBar: { height: 10, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 6, marginTop: 12, overflow: "hidden" },
  goalFill: { height: "100%", backgroundColor: C.clay, borderRadius: 6 },
  goalMeta: { color: "#CFE0D2", fontSize: 12.5, marginTop: 8 },
  goalLink: { color: "#F2C9A8", fontSize: 12.5, fontWeight: "700", marginTop: 6 },
  upNext: { color: "#E8DFC8", fontSize: 12.5, marginTop: 8, fontWeight: "600" },
  statRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  stat: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 13 },
  statN: { fontSize: 20, fontWeight: "700", color: C.ink },
  statL: { fontSize: 11.5, color: C.muted, marginTop: 2, lineHeight: 15 },
  weekStrip: { flexDirection: "row", justifyContent: "space-between", marginTop: 16, paddingHorizontal: 4 },
  weekDay: { alignItems: "center", gap: 4 },
  weekDot: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: C.card,
    borderWidth: 1.5, borderColor: C.line, alignItems: "center", justifyContent: "center",
  },
  weekDotOn: { backgroundColor: C.pine, borderColor: C.pine },
  weekDotText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  weekLabel: { fontSize: 10.5, color: C.muted, fontWeight: "700" },
  lessonLabel: { fontSize: 16.5, fontWeight: "700", color: C.ink, marginTop: 6 },
  quest: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  questTick: { fontSize: 16, fontWeight: "800", color: C.muted, width: 20 },
  questTickOn: { color: C.pine },
  questText: { fontSize: 14, color: C.ink, fontWeight: "600" },
  questAll: { fontSize: 13, color: "#8A5D14", fontWeight: "800", marginTop: 12, textAlign: "center" },
});
