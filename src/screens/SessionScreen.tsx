import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Share, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import {
  AppData, Story, Category, Concept, Exercise, Grade, LearningStyle, PendingSession,
  ResultEntry, daysFromNow, levelFor, levelTitle, todayKey,
} from "../types";
import { gradeExercise } from "../srs";
import { checkAnswer, Verdict } from "../answer";
import { saveData } from "../storage";
import { initSpeech, speak, stopSpeech, setVoice } from "../speech";
import { playSfx, SfxKind } from "../sfx";
import { fetchImageFor } from "../images";
import { Btn, Chip, Eyebrow, ImgLoad, ConceptVisual, catTone, Mascot } from "../components/UI";
import { C } from "../theme";
import Confetti from "../components/Confetti";
import { LinearGradient } from "expo-linear-gradient";

const shuffle = <T,>(a: T[]) => [...a].sort(() => Math.random() - 0.5);
const XP: Record<Grade, number> = { easy: 10, good: 8, hard: 5, again: 2 };
const PIC_XP = 5;
const COMBO_BONUS = 2;
const PRAISE = ["Smashing!", "Top marks!", "Lovely stuff!", "Brilliant!", "Spot on!", "Easy peasy!", "Superb!"];
const CONSOLE = ["No bother — it'll come back.", "Tricky one, that.", "Almost — next time."];
const verdictToGrade = (v: Verdict): Grade =>
  v === "correct" ? "good" : v === "close" ? "hard" : "again";

/* legacy "flashcard" items are answered like "type" questions — auto-graded */
const effType = (ex: Exercise) => {
  const t = ex.type === "flashcard" ? "type" : ex.type === "odd" ? "mcq" : ex.type;
  if ((t === "mcq" || t === "stress") && (ex.choices?.length ?? 0) < 2) return "type"; // never render optionless choices
  return t;
};
const useTiles = (ex: Exercise) => {
  const t = effType(ex);
  return t === "listen" || ((t === "type" || t === "gap") && ex.answer.trim().split(/\s+/).length >= 3);
};

/* deterministic hash for stable picture-round choice ordering (resume-safe) */
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
};

type Step =
  | { kind: "story"; story: Story }                    // one narrative, several blanks
  | { kind: "speedgate" } // interstitial: "you've finished the lesson — now the speed round"
  | { kind: "speed"; ex: Exercise }
  | { kind: "intro"; concept: Concept }
  | { kind: "ex"; ex: Exercise; qNum: number; qTotal: number; firstOfConcept: boolean }
  | { kind: "picture"; concept: Concept; choices: string[] };

/** derived deterministically from (ids, data-at-analysis, style) so resume rebuilds identically */
function CountUp({ to, suffix = "", style }: { to: number; suffix?: string; style: any }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const v = new Animated.Value(0);
    const id = v.addListener(({ value }) => setVal(Math.round(value)));
    Animated.timing(v, { toValue: to, duration: 900, useNativeDriver: false }).start();
    return () => v.removeListener(id);
  }, [to]);
  return <Text style={style}>{val}{suffix}</Text>;
}

/** local look-ahead pass: two neighbouring questions sharing a "domain" tag
    (work, travel, food…) read as the same repeated scenario even when they
    come from different concepts — swap the second one for the nearest
    upcoming question with a different domain, deterministically (no
    Math.random — resume must rebuild the same order every time). Leaves the
    array untouched wherever domain data is missing (older imports) or a
    question directly follows its concept's intro (that pairing is deliberate). */
function diversifyDomains(steps: Step[]): Step[] {
  const arr = [...steps];
  const domainOf = (i: number) => {
    const st = arr[i];
    return st?.kind === "ex" ? st.ex.domain : undefined;
  };
  for (let i = 1; i < arr.length; i++) {
    const prev = domainOf(i - 1);
    if (!prev || domainOf(i) !== prev) continue;
    for (let j = i + 1; j < Math.min(arr.length, i + 6); j++) {
      if (arr[j].kind !== "ex" || arr[j - 1]?.kind === "intro") continue;
      const cand = domainOf(j);
      if (!cand || cand === prev || cand === domainOf(i + 1)) continue;
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      break;
    }
  }
  return arr;
}

function buildSteps(ids: string[], data: AppData, style: LearningStyle): Step[] {
  // one queue per concept: optional intro, then exercises easiest-recognition -> hardest-production
  const RANK: Record<string, number> = { stress: 0, mcq: 0, odd: 1, gap: 1, fix: 2, type: 2, flashcard: 2, listen: 3 };
  const order: string[] = [];
  const byConcept = new Map<string, Exercise[]>();
  for (const id of ids) {
    const ex = data.exercises.find((e) => e.id === id);
    if (!ex) continue;
    if ((ex.type === "mcq" || ex.type === "odd" || ex.type === "stress") && (ex.choices?.length ?? 0) < 2) continue; // never show a choice question without its choices
    if (!byConcept.has(ex.conceptId)) { byConcept.set(ex.conceptId, []); order.push(ex.conceptId); }
    byConcept.get(ex.conceptId)!.push(ex);
  }
  type Q = { concept?: Concept; items: (Step | null)[]; qTotal: number };
  const queues: Q[] = order.map((cid) => {
    const concept = data.concepts.find((c) => c.id === cid);
    const exs = [...byConcept.get(cid)!].sort((x, y) => (RANK[x.type] ?? 1) - (RANK[y.type] ?? 1));
    const items: (Step | null)[] = [];
    if (style === "learn" && concept && exs.some((e) => e.reps === 0)) items.push({ kind: "intro", concept });
    exs.forEach((ex, k) => items.push({ kind: "ex", ex, qNum: k + 1, qTotal: exs.length, firstOfConcept: k === 0 }));
    return { concept, items, qTotal: exs.length };
  });
  // staggered round-robin: concept k joins at wave k -> its questions spread out
  // between other concepts = spaced retrieval instead of massed repetition
  const steps: Step[] = [];
  const picturable = data.concepts.filter((c) => c.imageUrl?.startsWith("file"));
  const seen: Concept[] = [];
  let wave = 0;
  while (queues.some((q) => q.items.length > 0)) {
    queues.forEach((q, qi) => {
      if (qi > wave || q.items.length === 0) return;
      const st = q.items.shift()!;
      steps.push(st!);
      if (st!.kind === "intro" && q.items.length > 0) { steps.push(q.items.shift()!); } // first question right after its intro
      if (q.items.length === 0 && q.concept && q.concept.imageUrl?.startsWith("file")) seen.push(q.concept);
      // picture round roughly every 7 steps, recalling an already-finished concept
      if (steps.length % 7 === 6 && seen.length > 0 && picturable.length >= 4) {
        const target = seen.shift()!;
        const others = picturable.filter((c) => c.id !== target.id)
          .sort((x, y) => hash(x.id + target.id) - hash(y.id + target.id)).slice(0, 3).map((c) => c.title);
        const choices = [target.title, ...others].sort((x, y) => hash(x + target.id) - hash(y + target.id));
        steps.push({ kind: "picture", concept: target, choices });
      }
    });
    wave++;
    if (wave > 500) break; // safety
  }
  const diversified = diversifyDomains(steps);
  steps.length = 0; steps.push(...diversified);
  // story cloze: one narrative covering this session's concepts, if we have one
  const story = (data.stories ?? []).find((st) => st.answers.length >= 2 && st.conceptIds.some((cid) => order.includes(cid)));
  if (story) steps.push({ kind: "story", story });
  // finale: 45-second-feel speed round over up to 5 choice questions (XP only, no SRS)
  const speedPool = order.flatMap((cid) => byConcept.get(cid)!)
    .filter((e) => (e.type === "mcq" || e.type === "odd") && (e.choices?.length ?? 0) >= 2)
    .sort((x, y) => hash(x.id) - hash(y.id)).slice(0, 5);
  if (speedPool.length >= 3) {
    steps.push({ kind: "speedgate" });
    speedPool.forEach((ex) => steps.push({ kind: "speed", ex }));
  }
  return steps;
}

export default function SessionScreen({ data, setData, pending, exit }: {
  data: AppData; setData: (d: AppData) => void; pending: PendingSession; exit: () => void;
}) {
  /* style is read LIVE from settings at session start — changing it in
     Settings applies immediately, even to a resumed session */
  const liveStyle: LearningStyle = data.settings.learningStyle ?? pending.style ?? "quiz";
  const steps = useMemo(() => buildSteps(pending.ids, data, liveStyle), []); // eslint-disable-line
  /* resume position derived from WHAT was answered, never from a saved index —
     the step list can legitimately change between sessions */
  const initialIdx = useMemo(() => {
    const done = new Set(pending.results.map((r) => r.exId));
    let idx = 0;
    for (const st of steps) {
      if (st.kind === "ex") { if (done.has(st.ex.id)) { idx++; continue; } break; }
      if (st.kind === "picture") { if (done.has("pic:" + st.concept.id)) { idx++; continue; } break; }
      if (st.kind === "speed") { if (done.has("spd:" + st.ex.id)) { idx++; continue; } break; }
      if (st.kind === "story") { if (done.has("sto:" + st.story.id)) { idx++; continue; } break; }
      if (st.kind === "speedgate") { // resume lands ON the gate unless the round already began
        if (pending.results.some((r) => r.exId.startsWith("spd:"))) { idx++; continue; }
        break;
      }
      const conceptStarted = steps.some(
        (s2) => s2.kind === "ex" && s2.ex.conceptId === st.concept.id && done.has(s2.ex.id)
      );
      if (conceptStarted) { idx++; continue; }
      break;
    }
    return idx;
  }, []); // eslint-disable-line
  const [stepIdx, setStepIdx] = useState(initialIdx);
  const [results, setResults] = useState<ResultEntry[]>(pending.results);
  const [phase, setPhase] = useState<"answer" | "feedback">("answer");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [built, setBuilt] = useState<string[]>([]);
  const [pool, setPool] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [combo, setCombo] = useState(0);
  const [praise, setPraise] = useState("");
  const [img, setImg] = useState<string | null>(null);
  const [hintShown, setHintShown] = useState(false);
  const [quick, setQuick] = useState(false);
  const [undoToast, setUndoToast] = useState<{ msg: string; atIdx: number; priorResults: ResultEntry[]; priorData: AppData } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tick, setTick] = useState(8);          // speed-round countdown, seconds left
  const [timedOut, setTimedOut] = useState(false);
  const gatePulse = useRef(new Animated.Value(0)).current;
  const qStartRef = useRef(Date.now());
  const speedXpRef = useRef(0);
  const startRef = useRef(Date.now());
  const choicesRef = useRef<Record<string, string[]>>({});
  const savedRef = useRef(false);
  const comboXpRef = useRef(0);
  const levelBeforeRef = useRef(levelFor(data.xp));
  const [freezeNote, setFreezeNote] = useState<"used" | "earned" | null>(null);
  const pop = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(0)).current;

  const step = steps[stepIdx];
  const finished = stepIdx >= steps.length;
  const ex = step?.kind === "ex" ? step.ex : null;
  const concept: Concept | undefined =
    step?.kind === "intro" || step?.kind === "picture"
      ? step.concept
      : ex ? data.concepts.find((c) => c.id === ex.conceptId) : undefined;
  const tiles = ex ? useTiles(ex) : false;
  const answerables = steps.filter((s) => s.kind === "ex").length;
  const barAnim = useRef(new Animated.Value(0)).current;
  const answered = results.filter((r) => !r.exId.startsWith("pic:")).length;
  useEffect(() => {
    Animated.timing(barAnim, { toValue: answered / Math.max(1, answerables), duration: 350, useNativeDriver: false }).start();
  }, [answered]); // eslint-disable-line

  useEffect(() => { initSpeech(); setVoice(data.settings.voice ?? "gb"); }, []);

  useEffect(() => {
    if (finished || !step) return;
    slide.setValue(0);
    Animated.spring(slide, { toValue: 1, friction: 8, tension: 70, useNativeDriver: true }).start();
    qStartRef.current = Date.now();
    setImg(concept?.imageUrl ?? null);
    if (step.kind === "picture" && !concept?.imageUrl?.startsWith("file")) {
      // image never materialised → skip the round silently
      persist(data, stepIdx + 1, results);
      setStepIdx((i) => i + 1);
      return;
    }
    if (concept && !concept.imageUrl && concept.imageQuery) {
      fetchImageFor(concept).then((url) => {
        if (!url) return;
        setImg(url);
        const next = {
          ...data,
          concepts: data.concepts.map((c) => (c.id === concept.id ? { ...c, imageUrl: url } : c)),
        };
        setData(next); saveData(next);
      });
    }
    if (step.kind === "story") { setPool(shuffle([...step.story.answers])); setBuilt(new Array(step.story.answers.length).fill("")); }
    if (step.kind === "speedgate") {
      gatePulse.setValue(0);
      Animated.loop(Animated.sequence([
        Animated.timing(gatePulse, { toValue: 1, duration: 550, useNativeDriver: true }),
        Animated.timing(gatePulse, { toValue: 0, duration: 550, useNativeDriver: true }),
      ])).start();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    if (step.kind === "intro" && step.concept.example) {
      setTimeout(() => { if (step.kind === "intro") say(step.concept.example); }, 400);
    }
    if (ex && tiles) {
      const words = ex.answer.trim().split(/\s+/)
        .map((w) => w.toLowerCase().replace(/[.,!?;:"]+$/g, ""));
      setPool(shuffle(words)); setBuilt([]);
    }
    if (ex && (effType(ex) === "listen" || effType(ex) === "stress")) say(ex.prompt);
  }, [stepIdx]); // eslint-disable-line

  const persist = (nextData: AppData, nextIdx: number, nextResults: ResultEntry[]) => {
    const p: PendingSession = { ...pending, stepIdx: nextIdx, results: nextResults };
    const withPending = { ...nextData, pending: nextIdx >= steps.length ? null : p };
    setData(withPending); saveData(withPending);
  };

  /* finalise: streak (with freezes), xp, history */
  useEffect(() => {
    if (!finished || savedRef.current) return;
    savedRef.current = true;
    /* celebratory fanfare rides the same condition as the confetti */
    {
      const g = results.filter((r) => !r.skipped);
      const accNow = g.length ? (100 * g.filter((r) => r.correct).length) / g.length : 0;
      if (data.settings.sound !== false && accNow >= 60) playSfx("fanfare");
    }
    const t = todayKey();
    const dAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const graded = results.filter((r) => !r.skipped);
    const correct = graded.filter((r) => r.correct).length;
    const perfectBonus = graded.length > 0 && correct === graded.length && graded.length === results.length ? 10 : 0;
    const xpEarned = results.reduce((s, r) => s + (r.exId.startsWith("pic:") ? (r.correct ? PIC_XP : 0) : r.exId.startsWith("spd:") ? (r.correct ? 2 : 0) : r.exId.startsWith("sto:") ? 0 : XP[r.grade]), 0)
      + comboXpRef.current + speedXpRef.current + perfectBonus;

    let { count, lastDate } = data.streak;
    let freezes = data.freezes;
    if (lastDate !== t) {
      if (lastDate === dAgo(1)) count += 1;
      else if (lastDate === dAgo(2) && freezes > 0) { count += 1; freezes -= 1; setFreezeNote("used"); }
      else count = 1;
      lastDate = t;
      if (count > 0 && count % 7 === 0 && freezes < 2) { freezes += 1; setFreezeNote("earned"); }
    }
    const touched = [...new Set(results.map((r) => {
      if (r.exId.startsWith("pic:")) return data.concepts.find((c) => c.id === r.exId.slice(4))?.title ?? "";
      const e = data.exercises.find((k) => k.id === r.exId.replace(/^spd:/, ""));
      return data.concepts.find((c) => c.id === e?.conceptId)?.title ?? "";
    }).filter(Boolean))];
    const next: AppData = {
      ...data, xp: data.xp + xpEarned, freezes, pending: null,
      streak: { count, lastDate },
      sessions: [
        ...data.sessions.filter((s) => s.date !== t),
        (() => { // a later sitting must never ERASE the day's earlier achievements
          const prev = data.sessions.find((s) => s.date === t);
          return {
            date: t,
            done: (prev?.done ?? 0) + results.length,
            correct: (prev?.correct ?? 0) + correct,
            xp: (prev?.xp ?? 0) + xpEarned,
            concepts: [...new Set([...(prev?.concepts ?? []), ...touched] as string[])],
            minutes: (prev?.minutes ?? 0) + Math.max(1, Math.round((Date.now() - startRef.current) / 60000)),
          };
        })(),
      ],
    };
    setData(next); saveData(next);
  }, [finished]); // eslint-disable-line

  const animatePop = () => {
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start();
  };

  const clearInput = () => {
    setPhase("answer"); setVerdict(null); setPicked(null); setTyped("");
    setBuilt([]); setPool([]); setRevealed(false); setPraise("");
    setHintShown(false); setQuick(false);
  };

  /* verdict → feedback state, combo, haptics + sfx; sayText lets a question
     type choose what to reinforce aloud (stress replays the whole word) */
  const applyVerdict = (v: Verdict, sayText: string) => {
    setVerdict(v); setPhase("feedback");
    if (v === "wrong") {
      setCombo(0); setPraise(CONSOLE[Math.floor(Math.random() * CONSOLE.length)]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      sfx("bad");
    } else {
      const dt = (Date.now() - qStartRef.current) / 1000;
      if (dt < 8) { speedXpRef.current += 1; setQuick(true); }
      const c = combo + 1; setCombo(c);
      if (c >= 3) { comboXpRef.current += COMBO_BONUS; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); }
      setPraise(PRAISE[Math.floor(Math.random() * PRAISE.length)]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      sfx("ok");
    }
    animatePop();
    say(sayText); // audio reinforcement on every reveal
  };

  const judge = (given: string) => {
    if (!ex) return;
    applyVerdict(checkAnswer(given, ex.answer), ex.answer);
  };

  const commit = (grade: Grade, correct: boolean, skipped = false, base: AppData = data) => {
    if (!ex) return;
    const updated = gradeExercise(ex, grade);
    const nextResults: ResultEntry[] = [...results, {
      exId: ex.id, grade, correct, skipped,
      cat: (concept?.category ?? "Other") as Category, prompt: ex.prompt,
    }];
    const nextData = { ...base, exercises: base.exercises.map((e) => (e.id === ex.id ? updated : e)) };
    setResults(nextResults);
    persist(nextData, stepIdx + 1, nextResults);
    stopSpeech(); clearInput();
    setStepIdx((i) => i + 1);
  };

  const commitPicture = (correct: boolean) => {
    if (step?.kind !== "picture") return;
    const nextResults: ResultEntry[] = [...results, {
      exId: "pic:" + step.concept.id, grade: correct ? "good" : "again", correct,
      cat: step.concept.category, prompt: "Picture: " + step.concept.title,
    }];
    setResults(nextResults);
    persist(data, stepIdx + 1, nextResults);
    stopSpeech(); clearInput();
    setStepIdx((i) => i + 1);
  };

  /* "Skip"/"Later" jump straight to the next question with no pause to
     reconsider (unlike Reveal, which still shows a feedback screen first) —
     that's exactly where a mistimed tap is costly, so both get a few
     seconds' undo. Snapshots data BEFORE commit()'s SRS grade update, so
     undoing fully reverts the exercise's due/interval too, not just the UI. */
  const flashUndo = (msg: string) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoToast({ msg, atIdx: stepIdx, priorResults: results, priorData: data });
    undoTimer.current = setTimeout(() => setUndoToast(null), 4000);
  };
  const undoLast = () => {
    if (!undoToast) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    persist(undoToast.priorData, undoToast.atIdx, undoToast.priorResults);
    setResults(undoToast.priorResults);
    setStepIdx(undoToast.atIdx);
    stopSpeech(); clearInput();
    setUndoToast(null);
    Haptics.selectionAsync();
  };

  const skip = () => { if (ex) { flashUndo("Skipped"); setCombo(0); commit("again", false, true); } };

  const shelveForLater = () => {
    if (!ex) return;
    const cid = ex.conceptId;
    /* the shelved flag rides INSIDE commit's save — a separate save here
       would be overwritten by commit's stale-closure copy of data */
    const next = { ...data, concepts: data.concepts.map((c) => (c.id === cid ? { ...c, shelved: true } : c)) };
    flashUndo("Saved for later");
    setCombo(0);
    Haptics.selectionAsync();
    setPraise("🔖 Saved to your review shelf — find it in the Library");
    commit("again", false, true, next); // gentle skip; persists the shelf flag too
  };

  const reveal = () => {
    if (!ex) return;
    setRevealed(true); setVerdict("wrong"); setPhase("feedback");
    setCombo(0); setPraise("📖 Looked it up — seeing it counts too");
    Haptics.selectionAsync(); sfx("tick"); animatePop(); say(ex.answer);
  };
  const advanceIntro = () => { persist(data, stepIdx + 1, results); stopSpeech(); setStepIdx((i) => i + 1); };
  const exitSaving = () => { stopSpeech(); exit(); };
  const slideStyle = {
    opacity: slide,
    transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
  };

  const soundOn = data.settings.sound !== false;
  const say = (t: string) => { if (soundOn) speak(t); }; // auto-speech respects mute; manual taps always play
  const sfx = (k: SfxKind) => { if (soundOn) playSfx(k); }; // UI sounds respect mute too
  const toggleSound = () => {
    const next = { ...data, settings: { ...data.settings, sound: !soundOn } };
    setData(next); saveData(next);
    if (soundOn) stopSpeech();
    Haptics.selectionAsync();
  };

  const commitStory = (matches: number, total: number) => {
    if (step?.kind !== "story") return;
    speedXpRef.current += matches * 2; // partial credit, XP only
    const nextResults: ResultEntry[] = [...results, {
      exId: "sto:" + step.story.id, grade: matches === total ? "good" : "again", correct: matches === total,
      cat: "Other" as Category, prompt: "Story: " + step.story.text.slice(0, 60) + "…",
    }];
    setResults(nextResults);
    persist(data, stepIdx + 1, nextResults);
    stopSpeech(); clearInput();
    setStepIdx((i) => i + 1);
  };

  const commitSpeed = (correct: boolean) => {
    if (step?.kind !== "speed") return;
    const c = data.concepts.find((k) => k.id === step.ex.conceptId);
    const nextResults: ResultEntry[] = [...results, {
      exId: "spd:" + step.ex.id, grade: correct ? "good" : "again", correct,
      cat: (c?.category ?? "Other") as Category, prompt: step.ex.prompt,
    }];
    setResults(nextResults);
    persist(data, stepIdx + 1, nextResults);
    stopSpeech(); clearInput();
    setStepIdx((i) => i + 1);
  };

  // speed questions: visible 8s countdown; on zero, show "time's up" feedback, THEN advance
  useEffect(() => {
    if (step?.kind !== "speed" || phase !== "answer") return;
    setTick(8); setTimedOut(false);
    const deadline = Date.now() + 8000;
    let lastTicked = 9;
    const iv = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTick(left);
      if (left <= 3 && left > 0 && left < lastTicked) {
        lastTicked = left; // one soft urgency tick per remaining second
        Haptics.selectionAsync();
        if (data.settings.sound !== false) playSfx("tick");
      }
      if (left <= 0) {
        clearInterval(iv);
        setTimedOut(true); setPicked(null); setVerdict("wrong"); setPhase("feedback");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        if (data.settings.sound !== false) playSfx("bad");
        setTimeout(() => commitSpeed(false), 1100);
      }
    }, 120);
    return () => clearInterval(iv);
  }, [stepIdx, phase]); // eslint-disable-line

  /* ---------------- REPORT CARD ---------------- */
  if (finished) {
    const graded = results.filter((r) => !r.skipped);
    const skippedN = results.length - graded.length;
    const correct = graded.filter((r) => r.correct).length;
    const acc = results.length ? Math.round((100 * correct) / results.length) : 0; // skips count against accuracy, not just graded answers
    const xpEarned = results.reduce((s, r) => s + (r.exId.startsWith("pic:") ? (r.correct ? PIC_XP : 0) : r.exId.startsWith("spd:") ? (r.correct ? 2 : 0) : r.exId.startsWith("sto:") ? 0 : XP[r.grade]), 0)
      + comboXpRef.current + speedXpRef.current + (graded.length > 0 && correct === graded.length && skippedN === 0 ? 10 : 0);
    const levelAfter = levelFor(data.xp);
    const leveledUp = levelAfter > levelBeforeRef.current;
    const byCat = new Map<string, { c: number; t: number }>();
    for (const r of graded) {
      const e = byCat.get(r.cat) ?? { c: 0, t: 0 };
      e.t += 1; if (r.correct) e.c += 1; byCat.set(r.cat, e);
    }
    const perfect = graded.length > 0 && correct === graded.length && skippedN === 0;
    const tricky = results.filter((r) => r.grade === "again" && !r.skipped).slice(0, 5);
    const medal = perfect ? "🎯" : acc >= 90 ? "🏆" : acc >= 70 ? "🥈" : "💪";

    return (
      <ScrollView contentContainerStyle={s.wrap}>
        {(acc >= 60 || leveledUp) && <Confetti />}
        {perfect && (
          <View style={[s.levelUp, { backgroundColor: C.clay }]}>
            <Text style={s.levelUpText}>🎯 PERFECT LESSON — flawless! +10 XP</Text>
          </View>
        )}
        {leveledUp && (
          <View style={s.levelUp}>
            <Text style={s.levelUpText}>⬆ LEVEL UP — you're now a {levelTitle(data.xp)}!</Text>
          </View>
        )}
        {(() => {
          /* weekly best: today beat every other session of the last 7 days */
          const others = data.sessions.filter((sn) => sn.date !== todayKey() && sn.done > 0).slice(-7);
          const best = others.length ? Math.max(...others.map((sn) => Math.round((100 * sn.correct) / sn.done))) : -1;
          return graded.length >= 5 && best >= 0 && acc > best ? (
            <View style={[s.levelUp, { backgroundColor: C.purple }]}>
              <Text style={s.levelUpText}>🏅 NEW WEEKLY BEST — your highest accuracy in 7 days!</Text>
            </View>
          ) : null;
        })()}
        <LinearGradient colors={["#0E6B3D", "#0B5C33", "#084425"]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.reportHero}>
          <Text style={{ fontSize: 44 }}>{medal}</Text>
          <CountUp to={acc} suffix="%" style={s.reportAcc} />
          <Text style={s.reportSub}>
            {correct} of {results.length} correct{skippedN > 0 ? ` · ${skippedN} skipped` : ""} · +<CountUp to={xpEarned} suffix=" XP" style={s.reportSub} />
          </Text>
          <View style={s.streakBadge}>
            <Text style={s.streakText}>
              🔥 {data.streak.count}-day streak
              {data.freezes > 0 ? `   ❄️ ×${data.freezes}` : ""}
            </Text>
          </View>
          {freezeNote === "used" && <Text style={s.freezeNote}>❄️ A streak freeze saved your run — well kept.</Text>}
          {freezeNote === "earned" && <Text style={s.freezeNote}>❄️ Seven days straight — you've earned a streak freeze!</Text>}
        </LinearGradient>
        <Text style={s.section}>By category</Text>
        {[...byCat.entries()].map(([cat, v]) => (
          <View key={cat} style={s.catRow}>
            <Text style={s.catName}>{cat}</Text>
            <View style={s.catBar}><View style={[s.catFill, { width: `${(100 * v.c) / Math.max(1, v.t)}%` }]} /></View>
            <Text style={s.catScore}>{v.c}/{v.t}</Text>
          </View>
        ))}
        {tricky.length > 0 && (
          <>
            <Text style={s.section}>Worth another look</Text>
            {tricky.map((r, i) => {
              const src = data.exercises.find((e) => e.id === r.exId.replace(/^(spd:|pic:)/, ""));
              return (
                <TouchableOpacity key={r.exId + i} onPress={() => src && speak(src.answer)}>
                  <Text style={s.trickyItem}>• {r.prompt}</Text>
                  {src ? <Text style={s.trickyAns}>→ {src.answer}   🔊</Text> : null}
                </TouchableOpacity>
              );
            })}
            <Text style={s.note}>These come back tomorrow — that's the system working, not you failing.</Text>
          </>
        )}
        {data.sessions.length > 1 && (
          <>
            <Text style={s.section}>Your week</Text>
            <View style={s.sparkRow}>
              {[...data.sessions].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-7).map((sn) => {
                const a2 = sn.done ? Math.round((100 * sn.correct) / sn.done) : 0;
                return (
                  <View key={sn.date} style={s.sparkCol}>
                    <View style={[s.sparkBar, { height: Math.max(6, a2 * 0.4), backgroundColor: a2 >= 70 ? C.pine : C.clay }]} />
                    <Text style={s.sparkLabel}>{new Date(sn.date).toLocaleDateString("en-GB", { weekday: "narrow" })}</Text>
                  </View>
                );
              })}
            </View>
          </>
        )}
        {(() => {
          const tm = daysFromNow(1);
          const planTm = data.studyPlan?.days.find((d) => d.date === tm);
          const dueTm = data.exercises.filter((e) => e.reps > 0 && e.due === tm).length;
          return planTm || dueTm > 0 ? (
            <Text style={s.note}>Tomorrow: {planTm ? `${planTm.exerciseIds.length} planned` : "no new material"}{dueTm > 0 ? ` · ${dueTm} reviews due` : ""} — Marmalade will be waiting. 🐱</Text>
          ) : null;
        })()}
        <Btn label="Share today's result 📤" kind="ghost" style={{ marginTop: 10 }}
          onPress={() => {
            const okN = results.filter((r) => r.correct).length;
            Share.share({
              message: `Swotly ✅ ${okN}/${results.length} today · ${Math.round((100 * okN) / Math.max(1, results.length))}% accuracy${data.streak.count > 1 ? ` · ${data.streak.count}-day streak 🔥` : ""} — revising my English one session at a time. 🎾`,
            }).catch(() => {});
          }} />
        <Btn label="Back to Home" onPress={exitSaving} style={{ marginTop: 22 }} />
      </ScrollView>
    );
  }

  /* ---------------- LEARN CARD (distinct purple design) ---------------- */
  if (step.kind === "intro") {
    const c = step.concept;
    return (
      <ScrollView contentContainerStyle={s.wrap}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <TouchableOpacity onPress={exitSaving}><Text style={s.back}>← Save & exit</Text></TouchableOpacity>
          <TouchableOpacity onPress={toggleSound} hitSlop={{ top: 10, bottom: 10, left: 14, right: 14 }} style={s.soundPill}>
            <Text style={s.soundPillText}>{soundOn ? "Sound on" : "🔇 Muted"}</Text>
          </TouchableOpacity>
        </View>
        <View style={s.bar}><View style={[s.barFill, { width: `${(answered / Math.max(1, answerables)) * 100}%` }]} /></View>
        <Animated.View style={[s.learnCard, slideStyle]}>
          <View style={s.ribbonLearn}><Text style={s.ribbonLearnText}>📖 LEARN — NEW CONCEPT</Text></View>
          <ConceptVisual emoji={c.emoji} category={c.category} imageUrl={img ?? undefined} style={s.introImage} />
          <Text style={s.introTitle}>{c.title}</Text>
          <Chip tone={catTone(c.category)}>{c.category}</Chip>
          <Text style={s.introSummary}>{c.summary}</Text>
        {c.example ? (
            <TouchableOpacity style={s.exampleRow} onPress={() => speak(c.example)}>
              <Text style={s.exampleText}>“{c.example}”</Text>
              <Text style={{ fontSize: 18 }}>🔊</Text>
            </TouchableOpacity>
          ) : null}
          {c.tip ? <Text style={s.tip}>💡 {c.tip}</Text> : null}
        </Animated.View>
        <Btn label="Got it — quiz me" kind="marigold" onPress={advanceIntro} style={{ marginTop: 16 }} />
      </ScrollView>
    );
  }

  /* ---------------- SPEED GATE (interstitial) ---------------- */
  if (step.kind === "speedgate") {
    const scale = gatePulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });
    return (
      <View style={s.gateWrap}>
        <Text style={s.gateDone}>Lesson complete! 🎉</Text>
        <Animated.Text style={[s.gateBolt, { transform: [{ scale }] }]}>⚡</Animated.Text>
        <Text style={s.gateTitle}>SPEED ROUND</Text>
        <Text style={s.gateSub}>5 quick-fire questions · 8 seconds each{"\n"}+2 XP per hit · doesn't touch your revision plan</Text>
        <Btn label="GO ⚡" kind="marigold" onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          stopSpeech(); clearInput(); setStepIdx((i) => i + 1);
        }} style={{ marginTop: 26, minWidth: 180 }} />
      </View>
    );
  }

  /* ---------------- STORY CLOZE ---------------- */
  if (step.kind === "story") {
    const st = step.story;
    const parts = st.text.split(/\[(\d+)\]/); // odd indices are blank numbers
    const matches = built.filter((w, i) => checkAnswer(w, st.answers[i] ?? "") === "correct").length;
    return (
      <ScrollView contentContainerStyle={[s.wrap, { paddingBottom: 150 }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <TouchableOpacity onPress={exitSaving}><Text style={s.back}>← Save & exit</Text></TouchableOpacity>
          <TouchableOpacity onPress={toggleSound} hitSlop={{ top: 10, bottom: 10, left: 14, right: 14 }} style={s.soundPill}>
            <Text style={s.soundPillText}>{soundOn ? "Sound on" : "🔇 Muted"}</Text>
          </TouchableOpacity>
        </View>
        <View style={[s.picCard, { backgroundColor: C.sage, borderColor: C.pine }]}>
          <View style={[s.ribbonPic, { backgroundColor: C.pine }]}><Text style={s.ribbonPicText}>📖 STORY TIME — fill the tale</Text></View>
          <Text style={[s.prompt, { lineHeight: 30 }]}>
            {parts.map((part, i) => {
              if (i % 2 === 0) return <Text key={i}>{part}</Text>;
              const bi = parseInt(part, 10) - 1;
              const word = built[bi];
              const good = phase === "feedback" && word != null && checkAnswer(word, st.answers[bi] ?? "") === "correct";
              const bad = phase === "feedback" && !good;
              return (
                <Text key={i}
                  onPress={() => { if (phase === "answer" && word) setBuilt((b) => b.map((w, k) => (k === bi ? "" : w))); }}
                  style={{
                    fontWeight: "900",
                    color: good ? C.pine : bad ? C.rose : word ? C.purple : C.muted,
                    textDecorationLine: word ? "none" : "underline",
                  }}>
                  {word ? ` ${word} ` : " ______ "}
                </Text>
              );
            })}
          </Text>
          {phase === "feedback" && matches < st.answers.length && (
            <Text style={[s.note, { marginTop: 10 }]}>Correct order: {st.answers.join(" · ")}</Text>
          )}
        </View>
        {phase === "answer" && (
          <>
            <Text style={s.note}>Tap the phrases in story order…</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {pool.map((w, i) => {
                return (
                  <TouchableOpacity key={w + i} disabled={built.includes(w)}
                    onPress={() => setBuilt((b) => {
                      const slot = b.findIndex((x) => !x); // first EMPTY blank, not the end — a mid-story removal must refill its own gap
                      return slot === -1 ? b : b.map((x, k) => (k === slot ? w : x));
                    })}
                    style={[s.choice, { paddingVertical: 10, opacity: built.includes(w) ? 0.35 : 1 }]}>
                    <Text style={s.choiceText}>{w}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Btn label="Check" kind="marigold" disabled={built.some((w) => !w)}
              onPress={() => {
                setVerdict(matches === st.answers.length ? "correct" : "wrong"); // matches computed at render with full built
                setPhase("feedback");
                const allRight = built.filter((w, i) => checkAnswer(w, st.answers[i] ?? "") === "correct").length === st.answers.length;
                Haptics.notificationAsync(allRight ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
                sfx(allRight ? "ok" : "bad");
              }} style={{ marginTop: 14 }} />
          </>
        )}
        {phase === "feedback" && (
          <>
            <View style={[s.speedVerdict, matches === st.answers.length
              ? { backgroundColor: C.sage, borderColor: C.pine }
              : { backgroundColor: C.roseBg, borderColor: C.rose }]}>
              <Text style={[s.speedVerdictText, { color: matches === st.answers.length ? C.pineDeep : C.rose }]}>
                {matches === st.answers.length ? `✓ Perfect tale! +${matches * 2} XP` : `${matches} of ${st.answers.length} right · +${matches * 2} XP`}
              </Text>
            </View>
            <Btn label="Next" onPress={() => { sfx("tick"); commitStory(matches, st.answers.length); }} style={{ marginTop: 10 }} />
          </>
        )}
      </ScrollView>
    );
  }

  /* ---------------- SPEED ROUND ---------------- */
  if (step.kind === "speed") {
    const sx = step.ex;
    if (!choicesRef.current["spd" + sx.id]) {
      choicesRef.current["spd" + sx.id] = [...(sx.choices || [])].sort((a, b) => hash(a + sx.id) - hash(b + sx.id));
    }
    return (
      <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.wrap, { paddingBottom: 150 }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <TouchableOpacity onPress={exitSaving}><Text style={s.back}>← Save & exit</Text></TouchableOpacity>
          <TouchableOpacity onPress={toggleSound} hitSlop={{ top: 10, bottom: 10, left: 14, right: 14 }} style={s.soundPill}>
            <Text style={s.soundPillText}>{soundOn ? "Sound on" : "🔇 Muted"}</Text>
          </TouchableOpacity>
        </View>
        <View style={[s.picCard, { backgroundColor: C.amberBg, borderColor: C.clay }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={[s.ribbonPic, { backgroundColor: C.clay }]}><Text style={s.ribbonPicText}>⚡ SPEED ROUND</Text></View>
            <Text style={[s.speedClock, tick <= 3 && phase === "answer" && { color: C.rose }]}>{phase === "answer" ? `${tick}s` : ""}</Text>
          </View>
          <Text style={s.prompt}>{sx.prompt}</Text>
          <View style={s.speedBarWrap}>
            <View style={[s.speedBarFill, { width: `${(tick / 8) * 100}%` }, tick <= 3 && { backgroundColor: C.rose }]} />
          </View>
        </View>
        {phase === "feedback" && (
          <View style={[s.speedVerdict, verdict === "correct"
            ? { backgroundColor: C.sage, borderColor: C.pine }
            : { backgroundColor: C.roseBg, borderColor: C.rose }]}>
            <Text style={[s.speedVerdictText, { color: verdict === "correct" ? C.pineDeep : C.rose }]}>
              {timedOut ? "⏰ Time's up!" : verdict === "correct" ? "✓ Correct! +2 XP" : "✗ Not quite"}
            </Text>
          </View>
        )}
        {choicesRef.current["spd" + sx.id].map((choice) => {
          const isAnswer = checkAnswer(choice, sx.answer) === "correct";
          const isPicked = picked === choice;
          let bg = C.card, border = C.line, fg = C.ink;
          if (phase === "feedback") {
            if (isAnswer) { bg = C.sage; border = C.pine; fg = C.pineDeep; }
            else if (isPicked) { bg = C.roseBg; border = C.rose; fg = C.rose; }
          }
          return (
            <TouchableOpacity key={choice} disabled={phase === "feedback"} activeOpacity={0.8}
              style={[s.choice, { backgroundColor: bg, borderColor: border }]}
              onPress={() => {
                setPicked(choice); setVerdict(isAnswer ? "correct" : "wrong"); setPhase("feedback");
                Haptics.notificationAsync(isAnswer ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
                sfx(isAnswer ? "ok" : "bad");
                setTimeout(() => commitSpeed(isAnswer), 1000); // long enough to SEE the verdict
              }}>
              <Text style={[s.choiceText, { color: fg }]}>{choice}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      </View>
    );
  }

  /* ---------------- PICTURE ROUND ---------------- */
  if (step.kind === "picture") {
    return (
      <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.wrap, { paddingBottom: 150 }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <TouchableOpacity onPress={exitSaving}><Text style={s.back}>← Save & exit</Text></TouchableOpacity>
          <TouchableOpacity onPress={toggleSound} hitSlop={{ top: 10, bottom: 10, left: 14, right: 14 }} style={s.soundPill}>
            <Text style={s.soundPillText}>{soundOn ? "Sound on" : "🔇 Muted"}</Text>
          </TouchableOpacity>
        </View>
        <View style={s.bar}><View style={[s.barFill, { width: `${(answered / Math.max(1, answerables)) * 100}%` }]} /></View>
        <Animated.View style={[s.picCard, slideStyle]}>
          <View style={s.ribbonPic}><Text style={s.ribbonPicText}>📸 PICTURE ROUND</Text></View>
          {img ? (
            <ImgLoad uri={img} style={s.picImage} />
          ) : (
            <Text style={{ fontSize: 64, textAlign: "center" }}>{step.concept.emoji || "🖼️"}</Text>
          )}
          <Text style={s.picQuestion}>Which concept does this bring to mind?</Text>
        </Animated.View>
        {step.choices.map((choice) => {
          const isAnswer = choice === step.concept.title;
          const isPicked = picked === choice;
          let bg = C.card, border = C.line, fg = C.ink;
          if (phase === "feedback") {
            if (isAnswer) { bg = C.sage; border = C.pine; fg = C.pineDeep; }
            else if (isPicked) { bg = C.roseBg; border = C.rose; fg = C.rose; }
          }
          return (
            <TouchableOpacity key={choice} disabled={phase === "feedback"} activeOpacity={0.8}
              style={[s.choice, { backgroundColor: bg, borderColor: border }]}
              onPress={() => {
                setPicked(choice); setVerdict(isAnswer ? "correct" : "wrong"); setPhase("feedback");
                Haptics.notificationAsync(isAnswer ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
                sfx(isAnswer ? "ok" : "bad");
              }}>
              <Text style={[s.choiceText, { color: fg }]}>{choice}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {phase === "feedback" && (
        <View style={s.footer}>
          <Text style={[s.verdict, { color: verdict === "correct" ? C.pineDeep : C.rose }]}>
            {verdict === "correct" ? "Good eye! +5 XP 📸" : `It was "${step.concept.title}" — noted for later.`}
          </Text>
          <Btn label="Next" onPress={() => { sfx("tick"); commitPicture(verdict === "correct"); }} style={{ marginTop: 10 }} />
        </View>
      )}
    </View>
    );
  }

  /* ---------------- QUESTION CARD (distinct clay design) ---------------- */
  if (effType(ex!) === "mcq" && !choicesRef.current[ex!.id]) {
    choicesRef.current[ex!.id] = shuffle(ex!.choices || []);
  }
  const SpeakBtn = ({ text }: { text: string }) => (
    <TouchableOpacity onPress={() => speak(text)} style={s.speak}
      accessibilityRole="button" accessibilityLabel="Play pronunciation">
      <Text style={{ fontSize: 18 }}>🔊</Text>
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[s.wrap, phase === "answer" && s.wrapWithActionBar]} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <TouchableOpacity onPress={exitSaving}><Text style={s.back}>← Save & exit</Text></TouchableOpacity>
          <TouchableOpacity onPress={toggleSound} hitSlop={{ top: 10, bottom: 10, left: 14, right: 14 }} style={s.soundPill}>
            <Text style={s.soundPillText}>{soundOn ? "Sound on" : "🔇 Muted"}</Text>
          </TouchableOpacity>
        </View>
        <View style={s.barRow}>
          <View style={[s.bar, { flex: 1, marginBottom: 0 }]}><Animated.View style={[s.barFill, { width: barAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} /></View>
          <View style={s.leftPill}><Text style={s.leftPillText}>{answerables - answered} left · ~{Math.max(1, Math.ceil(((answerables - answered) * 12) / 60))} min</Text></View>
        </View>

        {/* concept context strip */}
        <View style={[s.contextStrip, { borderLeftWidth: 5, borderLeftColor: catTone(concept?.category).fg }]}>
          <Text style={s.contextEmoji}>{ex && phase === "answer" ? "🎯" : (concept?.emoji || "📘")}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.contextTitle}>{ex && phase === "answer" ? "Mystery — can you place it?" : (concept?.title ?? "")}</Text>
            <Text style={s.contextMeta}>{step.qNum > 1 ? "🔁 spaced review · " : ""}{concept?.category} · question {step.qNum} of {step.qTotal}</Text>
          </View>
          {combo >= 3 && <Text style={s.comboText}>🔥 {combo}</Text>}
        </View>

        <Animated.View style={[s.questionCard, slideStyle, { borderLeftColor: catTone(concept?.category).fg }]}>
          <View style={s.ribbonQ}><Text style={s.ribbonQText}>{({ mcq: "✅ CHOOSE", gap: "🧩 FILL THE GAP", type: "✍️ TYPE IT", flashcard: "✍️ TYPE IT", listen: "🎧 LISTEN", fix: "🔍 FIX THE MISTAKE", stress: "🎯 TAP THE STRESS" } as any)[effType(ex!)] ?? "❓ QUESTION"}</Text></View>
          {img?.startsWith("file") && step.qNum === 1 ? <ImgLoad uri={img} style={s.qImage} /> : null}
          {effType(ex!) === "listen" ? (
            <>
              <Text style={s.prompt}>Listen, then rebuild the sentence</Text>
              <TouchableOpacity onPress={() => speak(ex!.prompt)} style={s.bigSpeak}>
                <Text style={{ fontSize: 34 }}>🔊</Text>
                <Text style={s.bigSpeakLabel}>Tap to hear it again</Text>
              </TouchableOpacity>
            </>
          ) : effType(ex!) === "stress" ? (
            <>
              <Text style={s.prompt}>Which syllable carries the stress?</Text>
              <Text style={s.stressWord}>{ex!.prompt}</Text>
              <TouchableOpacity onPress={() => speak(ex!.prompt)} style={s.bigSpeak}>
                <Text style={{ fontSize: 30 }}>🔊</Text>
                <Text style={s.bigSpeakLabel}>Hear it, then tap the strong syllable</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={s.promptRow}>
              <Text style={[s.prompt, { flex: 1 }]}>{ex!.prompt}</Text>
              <SpeakBtn text={ex!.prompt} />
            </View>
          )}
          {phase === "feedback" && effType(ex!) !== "mcq" && effType(ex!) !== "stress" && (
            <View style={s.answerRow}>
              <Text style={s.answer}>{ex!.answer}</Text>
              <SpeakBtn text={ex!.answer} />
            </View>
          )}
          {phase === "feedback" && concept?.tip ? (
            <Text style={s.tip}>💡 {concept.tip}</Text>
          ) : null}
        </Animated.View>

        {effType(ex!) === "mcq" && choicesRef.current[ex!.id].map((choice) => {
          const isAnswer = checkAnswer(choice, ex!.answer) === "correct";
          const isPicked = picked === choice;
          let bg = C.card, border = C.line, fg = C.ink;
          if (phase === "feedback") {
            if (isAnswer) { bg = C.sage; border = C.pine; fg = C.pineDeep; }
            else if (isPicked) { bg = C.roseBg; border = C.rose; fg = C.rose; }
          }
          return (
            <TouchableOpacity key={choice} disabled={phase === "feedback"} activeOpacity={0.8}
              style={[s.choice, { backgroundColor: bg, borderColor: border }]}
              onPress={() => { setPicked(choice); judge(choice); }}>
              <Text style={[s.choiceText, { color: fg }]}>{choice}</Text>
            </TouchableOpacity>
          );
        })}

        {tiles && phase === "answer" && (
          <>
            <View style={s.builtRow}>
              {built.length === 0 ? (
                <Text style={s.builtPlaceholder}>Tap the words in order…</Text>
              ) : built.map((w, i) => (
                <TouchableOpacity key={w + i} style={s.tileOn}
                  onPress={() => { setBuilt(built.filter((_, k) => k !== i)); setPool([...pool, w]); }}>
                  <Text style={s.tileOnText}>{w}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.poolRow}>
              {pool.map((w, i) => (
                <TouchableOpacity key={w + i} style={s.tile}
                  onPress={() => { setPool(pool.filter((_, k) => k !== i)); setBuilt([...built, w]); }}>
                  <Text style={s.tileText}>{w}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Btn label="Check" kind="marigold" disabled={pool.length > 0}
              onPress={() => judge(built.join(" "))} style={{ marginTop: 12 }} />
          </>
        )}

        {effType(ex!) === "stress" && (
          <View style={s.stressRow}>
            {(ex!.choices ?? []).map((syl, i) => {
              const isAnswer = syl.toLowerCase() === ex!.answer.toLowerCase();
              const key = syl + ":" + i;
              const isPicked = picked === key;
              let bg = C.card, border = C.line, fg = C.ink;
              if (phase === "feedback") {
                if (isAnswer) { bg = C.sage; border = C.pine; fg = C.pineDeep; }
                else if (isPicked) { bg = C.roseBg; border = C.rose; fg = C.rose; }
              }
              return (
                <TouchableOpacity key={key} disabled={phase === "feedback"} activeOpacity={0.8}
                  style={[s.stressTile, { backgroundColor: bg, borderColor: border }]}
                  onPress={() => { setPicked(key); applyVerdict(isAnswer ? "correct" : "wrong", ex!.prompt); }}>
                  <Text style={[s.stressTileText, { color: fg }, phase === "feedback" && isAnswer && { fontWeight: "900" }]}>
                    {phase === "feedback" && isAnswer ? syl.toUpperCase() : syl}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {!tiles && effType(ex!) !== "mcq" && effType(ex!) !== "listen" && effType(ex!) !== "stress" && phase === "answer" && (
          <>
            <TextInput
              style={s.input} value={typed} onChangeText={setTyped}
              placeholder={effType(ex!) === "gap" ? "Fill the gap…" : "Type your answer…"}
              placeholderTextColor={C.muted}
              autoCapitalize="none" autoCorrect={false} autoFocus returnKeyType="go"
              onSubmitEditing={() => typed.trim() && judge(typed)}
            />
            <Btn label="Check" kind="marigold" disabled={!typed.trim()}
              onPress={() => judge(typed)} style={{ marginTop: 10 }} />
          </>
        )}

        {phase === "answer" && (ex!.hint || concept?.tip) && (
          hintShown ? (
            <View style={[s.hintBox, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
              <View accessible={false}><Mascot size={26} mood="tip" /></View>
              <Text style={[s.hintText, { flex: 1, textAlign: "left" }]}>{ex!.hint || concept?.tip}</Text>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setHintShown(true)}
              hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }} style={s.hintPill}>
              <Text style={s.hintPillText}>💡 Need a hint?</Text>
            </TouchableOpacity>
          )
        )}
      </ScrollView>

      {/* pinned above the keyboard, well below the question — a single
          toolbar row (icon over label, hairline dividers) reads as one
          designed control instead of three loose buttons */}
      {phase === "answer" && (
        <View style={s.actionBar}>
          {undoToast && (
            <TouchableOpacity onPress={undoLast} style={s.undoToast}
              accessibilityRole="button" accessibilityLabel={`${undoToast.msg}. Tap to undo`}>
              <Text style={s.undoToastText}>↩️ {undoToast.msg} — tap to undo</Text>
            </TouchableOpacity>
          )}
          <View style={{ flexDirection: "row" }}>
            <TouchableOpacity onPress={reveal} style={s.actionBarItem} hitSlop={{ top: 6, bottom: 6 }}
              accessibilityRole="button" accessibilityLabel="Reveal the answer">
              <Text style={s.actionBarIcon}>👀</Text>
              <Text style={s.actionBarLabel}>Reveal</Text>
            </TouchableOpacity>
            <View style={s.actionBarDivider} />
            <TouchableOpacity onPress={shelveForLater} style={s.actionBarItem} hitSlop={{ top: 6, bottom: 6 }}
              accessibilityRole="button" accessibilityLabel="Save this question for later">
              <Text style={s.actionBarIcon}>🔖</Text>
              <Text style={s.actionBarLabel}>Later</Text>
            </TouchableOpacity>
            <View style={s.actionBarDivider} />
            <TouchableOpacity onPress={skip} style={s.actionBarItem} hitSlop={{ top: 6, bottom: 6 }}
              accessibilityRole="button" accessibilityLabel="Skip this question">
              <Text style={s.actionBarIcon}>⏭️</Text>
              <Text style={s.actionBarLabel}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {phase === "feedback" && (
        <View style={s.footer}>
          <Animated.View style={[s.praiseWrap, {
            transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
            backgroundColor: verdict === "wrong" ? C.roseBg : verdict === "close" ? C.amberBg : C.sage,
          }]}>
            <View accessible={false} style={{ marginBottom: 4 }}>
              <Mascot size={30} mood={verdict === "wrong" ? "sad" : verdict === "close" ? "tip" : "happy"} />
            </View>
            <Text style={[s.praise, { color: verdict === "wrong" ? C.rose : verdict === "close" ? C.amberInk : C.pineDeep }]}>
              {verdict === "correct" && `${praise} ✓`}
              {verdict === "close" && "So close — watch the spelling!"}
              {verdict === "wrong" && praise}
            </Text>
            {verdict !== "wrong" && <Text style={s.xpChip}>+{XP[verdictToGrade(verdict!)]} XP ⭐</Text>}
            {(() => {
              const nx = steps[stepIdx + 1];
              if (!nx) return null;
              const label = nx.kind === "speedgate" ? "⚡ Speed round" : nx.kind === "story" ? "📖 Story time"
                : nx.kind === "picture" ? "🖼 Picture round" : nx.kind === "intro" ? `✨ New: ${nx.concept.title}`
                : nx.kind === "ex" ? ({ mcq: "✅ Choose", gap: "🧩 Fill the gap", type: "✍️ Type it", flashcard: "✍️ Type it", listen: "🎧 Listen", fix: "🔍 Fix the mistake", stress: "🎯 Tap the stress" } as any)[effType(nx.ex)] ?? "Next question" : null;
              return label ? <Text style={s.nextUp}>Next up: {label}</Text> : null;
            })()}
            {combo >= 3 && verdict !== "wrong" && <Text style={s.comboBonus}>Combo +{COMBO_BONUS} XP</Text>}
          </Animated.View>
          <Btn label="Next" onPress={() => { sfx("tick"); commit(verdictToGrade(verdict!), verdict !== "wrong"); }}
            style={{ marginTop: 10 }} />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}


const s = StyleSheet.create({
  wrap: { padding: 18, paddingBottom: 40 },
  wrapWithActionBar: { paddingBottom: 170 }, // clears the pinned bar + undo toast, with headroom for larger accessibility text sizes
  back: { color: C.pine, fontWeight: "700", fontSize: 14, marginBottom: 14 },
  bar: { height: 6, backgroundColor: C.line, borderRadius: 4, overflow: "hidden", marginBottom: 14 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  leftPill: { backgroundColor: C.purpleBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  leftPillText: { fontSize: 11.5, fontWeight: "800", color: C.purple },
  barFill: { height: "100%", backgroundColor: C.clay, borderRadius: 4 },
  contextStrip: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.sage, borderRadius: 14, padding: 10, marginBottom: 12,
  },
  contextEmoji: { fontSize: 22 },
  contextTitle: { fontSize: 14.5, fontWeight: "700", color: C.pineDeep },
  contextMeta: { fontSize: 11.5, color: C.muted, marginTop: 1 },
  comboText: { fontSize: 13, fontWeight: "700", color: C.clay },
  learnCard: {
    backgroundColor: C.purpleBg, borderWidth: 1.5, borderColor: C.purple, borderRadius: 22,
    padding: 20, paddingTop: 14, alignItems: "center", overflow: "hidden",
  },
  ribbonLearn: {
    alignSelf: "flex-start", backgroundColor: C.purple, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4, marginBottom: 12,
  },
  ribbonLearnText: { color: "#fff", fontSize: 10.5, fontWeight: "800", letterSpacing: 0.8 },
  questionCard: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderLeftWidth: 5,
    borderLeftColor: C.clay, borderRadius: 18, padding: 20, paddingTop: 12,
  },
  ribbonQ: {
    alignSelf: "flex-start", backgroundColor: C.amberBg, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 3, marginBottom: 10,
  },
  ribbonQText: { color: C.clay, fontSize: 10.5, fontWeight: "800", letterSpacing: 0.8 },
  qImage: { width: "100%", height: 110, borderRadius: 12, marginBottom: 12 },
  picCard: {
    backgroundColor: C.sage, borderWidth: 1.5, borderColor: C.pine, borderRadius: 22,
    padding: 20, paddingTop: 14, overflow: "hidden",
  },
  ribbonPic: {
    alignSelf: "flex-start", backgroundColor: C.pine, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4, marginBottom: 12,
  },
  ribbonPicText: { color: "#fff", fontSize: 10.5, fontWeight: "800", letterSpacing: 0.8 },
  speedClock: { fontSize: 22, fontWeight: "900", color: C.clay, fontVariant: ["tabular-nums"] },
  speedBarWrap: { height: 6, borderRadius: 3, backgroundColor: C.line, marginTop: 12, overflow: "hidden" },
  speedBarFill: { height: 6, borderRadius: 3, backgroundColor: C.clay },
  speedVerdict: { borderWidth: 1.5, borderRadius: 12, paddingVertical: 10, alignItems: "center", marginBottom: 10 },
  speedVerdictText: { fontSize: 15, fontWeight: "800" },
  xpChip: { fontSize: 13, fontWeight: "900", color: C.amberInk, marginTop: 2 },
  soundPill: { borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: C.card },
  soundPillText: { fontSize: 12, fontWeight: "700", color: C.muted },
  nextUp: { fontSize: 12, fontWeight: "700", color: C.muted, marginTop: 4 },
  gateWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: C.paper },
  gateDone: { fontSize: 15, fontWeight: "700", color: C.muted, marginBottom: 18 },
  gateBolt: { fontSize: 76 },
  gateTitle: { fontSize: 26, fontWeight: "900", color: C.clay, letterSpacing: 2, marginTop: 10 },
  gateSub: { fontSize: 13.5, color: C.muted, textAlign: "center", marginTop: 10, lineHeight: 20 },
  picImage: { width: "100%", height: 170, borderRadius: 14 },
  picQuestion: { fontSize: 17, fontWeight: "700", color: C.pineDeep, marginTop: 14, textAlign: "center" },
  promptRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  prompt: { fontSize: 20, fontWeight: "600", color: C.ink, lineHeight: 28 },
  answerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, justifyContent: "center" },
  answer: { fontSize: 17, color: C.pineDeep, lineHeight: 24, flexShrink: 1 },
  tip: { fontSize: 13, color: C.muted, marginTop: 12, lineHeight: 19, textAlign: "center" },
  speak: { padding: 4 },
  bigSpeak: { alignItems: "center", marginTop: 14 },
  bigSpeakLabel: { fontSize: 12, color: C.muted, marginTop: 4, fontWeight: "700" },
  nudge: { fontSize: 13, color: C.muted, textAlign: "center", marginTop: 12 },
  actionBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: C.paper, borderTopWidth: 1, borderTopColor: C.line,
    paddingTop: 10, paddingBottom: 14, paddingHorizontal: 10,
  },
  actionBarItem: { flex: 1, alignItems: "center", gap: 3, paddingVertical: 4 },
  actionBarIcon: { fontSize: 18 },
  actionBarLabel: { fontSize: 11.5, fontWeight: "700", color: C.muted },
  actionBarDivider: { width: 1, backgroundColor: C.line, marginVertical: 6 },
  undoToast: { backgroundColor: C.purpleBg, borderRadius: 12, paddingVertical: 9, alignItems: "center", marginHorizontal: 8, marginBottom: 8 },
  undoToastText: { fontSize: 12.5, fontWeight: "700", color: C.purple },
  hintPill: {
    alignSelf: "center", backgroundColor: C.amberBg, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 7, marginTop: 16,
  },
  hintPillText: { fontSize: 13, fontWeight: "700", color: C.amberInk },
  hintBox: { backgroundColor: C.amberBg, borderRadius: 12, padding: 12, marginTop: 16 },
  hintText: { fontSize: 13.5, color: C.amberInk, lineHeight: 19, textAlign: "center" },
  remember: { fontSize: 12.5, color: C.muted, textAlign: "center", marginTop: 8, lineHeight: 18 },
  grades: { flexDirection: "row", gap: 8, marginTop: 14 },
  grade: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  choice: { borderWidth: 1.5, borderRadius: 14, padding: 15, marginTop: 10, backgroundColor: C.card },
  choiceText: { fontSize: 15.5, fontWeight: "500" },
  input: {
    borderWidth: 1.5, borderColor: C.line, borderRadius: 14, padding: 14, marginTop: 14,
    fontSize: 16, backgroundColor: C.card, color: C.ink,
  },
  verdict: { fontSize: 15.5, fontWeight: "700", textAlign: "center", lineHeight: 22 },
  builtRow: {
    flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16, minHeight: 46,
    borderBottomWidth: 1.5, borderBottomColor: C.line, paddingBottom: 10,
  },
  builtPlaceholder: { color: C.muted, fontSize: 14, paddingTop: 8 },
  poolRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  tile: {
    backgroundColor: C.card, borderWidth: 1.5, borderColor: C.line,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
  },
  tileText: { fontSize: 15.5, fontWeight: "600", color: C.ink },
  tileOn: {
    backgroundColor: C.purpleBg, borderWidth: 1.5, borderColor: C.purple,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
  },
  tileOnText: { fontSize: 15.5, fontWeight: "600", color: C.purple },
  stressWord: { fontSize: 28, fontWeight: "800", color: C.ink, textAlign: "center", marginTop: 12, letterSpacing: 0.5 },
  stressRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16, justifyContent: "center" },
  stressTile: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, minWidth: 56, alignItems: "center" },
  stressTileText: { fontSize: 17, fontWeight: "700" },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: C.paper, borderTopWidth: 1, borderTopColor: C.line,
    paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14,
  },
  praiseWrap: { borderRadius: 14, padding: 12, alignItems: "center" },
  praise: { fontSize: 16, fontWeight: "700" },
  comboBonus: { fontSize: 12.5, fontWeight: "700", color: C.clay, marginTop: 4 },
  introImage: { width: "100%", height: 150, borderRadius: 14, marginBottom: 12 },
  introEmoji: { fontSize: 46, marginBottom: 6 },
  introTitle: { fontSize: 22, fontWeight: "700", color: C.ink, textAlign: "center", marginBottom: 8 },
  introSummary: { fontSize: 15, color: C.ink, lineHeight: 22, marginTop: 10, textAlign: "center" },
  exampleRow: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14,
    backgroundColor: "#fff", borderRadius: 12, padding: 12,
  },
  exampleText: { fontSize: 14.5, color: C.purple, fontStyle: "italic", flexShrink: 1 },
  levelUp: {
    backgroundColor: C.purple, borderRadius: 16, padding: 14, marginBottom: 12, alignItems: "center",
  },
  levelUpText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  reportHero: { backgroundColor: C.pine, borderRadius: 22, padding: 26, alignItems: "center", marginBottom: 20 },
  reportAcc: { fontSize: 46, fontWeight: "700", color: "#F2F7F1", marginTop: 4 },
  reportSub: { fontSize: 14.5, color: "#CFE0D2", marginTop: 4 },
  streakBadge: {
    backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 6, marginTop: 12,
  },
  streakText: { color: "#F2F7F1", fontWeight: "700", fontSize: 13.5 },
  freezeNote: { color: "#CFE0D2", fontSize: 12.5, marginTop: 10, textAlign: "center" },
  section: { fontSize: 13, fontWeight: "700", color: C.ink, marginTop: 14, marginBottom: 8 },
  catRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  catName: { width: 110, fontSize: 13.5, color: C.ink, fontWeight: "600" },
  catBar: { flex: 1, height: 8, backgroundColor: C.line, borderRadius: 4, overflow: "hidden" },
  catFill: { height: "100%", backgroundColor: C.clay, borderRadius: 4 },
  catScore: { width: 36, fontSize: 12.5, color: C.muted, textAlign: "right" },
  trickyItem: { fontSize: 13.5, color: C.ink, lineHeight: 20, marginBottom: 2 },
  trickyAns: { fontSize: 13.5, color: C.pine, fontWeight: "700", marginLeft: 14, marginBottom: 8 },
  sparkRow: { flexDirection: "row", alignItems: "flex-end", gap: 10, marginTop: 4, height: 56 },
  sparkCol: { alignItems: "center", gap: 4, flex: 1 },
  sparkBar: { width: 14, borderRadius: 4 },
  sparkLabel: { fontSize: 10, color: C.muted, fontWeight: "700" },
  note: { fontSize: 12.5, color: C.muted, marginTop: 6, lineHeight: 18 },
});
