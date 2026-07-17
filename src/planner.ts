import { AppData, CATEGORIES, Exercise, PlanDay, StudyPlan, todayKey } from "./types";

const SECONDS_PER_ITEM = 40;

export interface PlanMeta {
  reviews: number;
  overdueDays: number;          // how far back the oldest review reaches
  reviewLessons: string[];      // weekLabels the reviews come from
  fresh: number;
  freshLessons: string[];
  refreshers: number;
}

export interface Plan { items: Exercise[]; meta: PlanMeta; }

/** Daily plan: overdue reviews first (~70%), then new items, then early
 *  refreshers. Types are interleaved so a session never feels repetitive. */
export function buildPlan(data: AppData): Plan {
  const budget = Math.max(3, Math.round((data.settings.minutes * 60) / SECONDS_PER_ITEM));
  const t = todayKey();
  const due = data.exercises
    .filter((e) => e.reps > 0 && e.due <= t)
    .sort((a, b) => (a.due < b.due ? -1 : 1));
  const freshAll = data.exercises.filter((e) => e.reps === 0);

  const items: Exercise[] = [];
  for (const e of due) { if (items.length >= Math.ceil(budget * 0.7)) break; items.push(e); }
  const reviewsTaken = items.length;
  for (const e of freshAll) { if (items.length >= budget) break; items.push(e); }
  const freshTaken = items.length - reviewsTaken;
  for (const e of due) { if (items.length >= budget) break; if (!items.includes(e)) items.push(e); }
  const reviewsTotal = items.length - freshTaken;
  let refreshers = 0;
  if (items.length < budget) {
    const early = data.exercises
      .filter((e) => e.reps > 0 && e.due > t && !items.includes(e))
      .sort((a, b) => (a.due < b.due ? -1 : 1));
    for (const e of early) { if (items.length >= budget) break; items.push(e); refreshers++; }
  }

  // group by concept so related questions run together, preserving the
  // order in which each concept first appears (due-priority intact)
  const order: string[] = [];
  for (const e of items) if (!order.includes(e.conceptId)) order.push(e.conceptId);
  items.sort((a, b) => order.indexOf(a.conceptId) - order.indexOf(b.conceptId));

  const lessonsOf = (list: Exercise[]) => {
    const labels = new Set<string>();
    for (const e of list) {
      const c = data.concepts.find((k) => k.id === e.conceptId);
      if (c?.weekLabel) labels.add(c.weekLabel);
    }
    return [...labels].slice(0, 3);
  };
  const reviewItems = items.filter((e) => e.reps > 0 && e.due <= t);
  const freshItems = items.filter((e) => e.reps === 0);
  const oldestDue = reviewItems[0]?.due;
  const overdueDays = oldestDue
    ? Math.max(0, Math.round((new Date(t).getTime() - new Date(oldestDue).getTime()) / 86400000))
    : 0;

  return {
    items,
    meta: {
      reviews: reviewItems.length,
      overdueDays,
      reviewLessons: lessonsOf(reviewItems),
      fresh: freshItems.length,
      freshLessons: lessonsOf(freshItems),
      refreshers,
    },
  };
}

/** Build a multi-day calendar plan: whole concepts per day, categories
 *  balanced round-robin so every day is a healthy mix of themes. */
export function buildStudyPlan(data: AppData, daysCount: number, startDate: string): StudyPlan {
  const newExs = data.exercises.filter((e) => e.reps === 0);
  const byConcept = new Map<string, Exercise[]>();
  for (const e of newExs) {
    byConcept.set(e.conceptId, [...(byConcept.get(e.conceptId) ?? []), e]);
  }
  // category queues → round-robin for thematic balance
  const queues = CATEGORIES.map((cat) =>
    [...byConcept.keys()].filter(
      (cid) => (data.concepts.find((c) => c.id === cid)?.category ?? "Other") === cat
    )
  ).filter((q) => q.length > 0);
  const ordered: string[] = [];
  let qi = 0;
  while (queues.some((q) => q.length > 0)) {
    const q = queues[qi % queues.length];
    if (q.length > 0) ordered.push(q.shift()!);
    qi++;
  }

  const total = newExs.length;
  const perDay = Math.max(3, Math.ceil(total / Math.max(1, daysCount)));
  const days: PlanDay[] = [];
  const start = new Date(startDate);
  let di = 0;
  let day: PlanDay = { date: startDate, conceptIds: [], exerciseIds: [] };
  const pushDay = () => { if (day.exerciseIds.length) days.push(day); };
  for (const cid of ordered) {
    const exs = byConcept.get(cid)!;
    if (day.exerciseIds.length >= perDay && di < daysCount - 1) {
      pushDay(); di++;
      const d = new Date(start); d.setDate(d.getDate() + di);
      day = { date: d.toISOString().slice(0, 10), conceptIds: [], exerciseIds: [] };
    }
    day.conceptIds.push(cid);
    day.exerciseIds.push(...exs.map((e) => e.id));
  }
  pushDay();
  return { createdOn: todayKey(), startDate, days };
}

/** Per-lesson planning: distribute ONE lesson's fresh concepts evenly over the
 *  day count the user chose for THAT lesson, starting today. Days merge into the
 *  shared calendar by date, so overlapping lessons simply share a day — and when
 *  one lesson's run ends, only the others remain. */
/* A lesson that's ALREADY in the plan can gain fresh exercises when its
   concepts recur in a newly analysed file (mergeAnalysis appends them).
   Those don't deserve a full re-plan wizard — this folds them into the
   lesson's remaining days (lightest-loaded first), falling back to any
   upcoming day, without touching anything else in the calendar. */
export function foldFreshIntoPlan(data: AppData, lessonId: string): StudyPlan | null {
  const plan = data.studyPlan;
  if (!plan) return null;
  const t = todayKey();
  const cids = new Set(data.concepts.filter((c) => c.lessonId === lessonId).map((c) => c.id));
  const planned = new Set(plan.days.flatMap((d) => d.exerciseIds));
  const fresh = data.exercises.filter((e) => cids.has(e.conceptId) && e.reps === 0 && !planned.has(e.id));
  if (fresh.length === 0) return null;
  const days: PlanDay[] = plan.days.map((d) => ({ ...d, exerciseIds: [...d.exerciseIds], conceptIds: [...d.conceptIds] }));
  const exOf = (id: string) => data.exercises.find((k) => k.id === id);
  let targets = days.filter((d) => d.date >= t && d.exerciseIds.some((id) => { const e = exOf(id); return !!e && cids.has(e.conceptId); }));
  if (targets.length === 0) targets = days.filter((d) => d.date >= t);
  if (targets.length === 0) targets = [days[days.length - 1]];
  targets.sort((a, b) => a.exerciseIds.length - b.exerciseIds.length);
  fresh.forEach((e, i) => {
    const d = targets[i % targets.length];
    d.exerciseIds.push(e.id);
    if (!d.conceptIds.includes(e.conceptId)) d.conceptIds.push(e.conceptId);
  });
  return { ...plan, days };
}

export function weaveLessonPlan(data: AppData, lessonId: string, daysCount: number): StudyPlan | null {
  const plan: StudyPlan = data.studyPlan ?? { createdOn: todayKey(), startDate: todayKey(), days: [] };
  const planned = new Set(plan.days.flatMap((d) => d.exerciseIds));
  const lessonCids = new Set(data.concepts.filter((c) => c.lessonId === lessonId).map((c) => c.id));
  const fresh = data.exercises.filter((e) => e.reps === 0 && !planned.has(e.id) && lessonCids.has(e.conceptId));
  if (fresh.length === 0) return plan;
  const byConcept = new Map<string, Exercise[]>();
  for (const e of fresh) byConcept.set(e.conceptId, [...(byConcept.get(e.conceptId) ?? []), e]);
  const t = todayKey();
  const days = plan.days.map((d) => ({ ...d, conceptIds: [...d.conceptIds], exerciseIds: [...d.exerciseIds] }));
  const n = Math.max(1, daysCount);
  const cur = new Date(t + "T00:00:00");
  const slotDates: string[] = [];
  for (let i = 0; i < n; i++) {
    slotDates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  for (const dstr of slotDates) {
    if (!days.some((d) => d.date === dstr)) days.push({ date: dstr, conceptIds: [], exerciseIds: [] });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  const slots = slotDates.map((dstr) => days.find((d) => d.date === dstr)!);
  const cids = [...byConcept.keys()];
  cids.forEach((cid, i) => { // even CONCEPTS per day: 20 concepts / 5 days = 4 a day
    const slot = slots[i % n];
    slot.conceptIds.push(cid);
    slot.exerciseIds.push(...byConcept.get(cid)!.map((e) => e.id));
  });
  return { ...plan, days };
}

/** IDs for one SITTING of a day: sized by the user's session-length setting.
 *  Not-yet-done items come first; a dense plan day simply takes two or three
 *  sittings ("Continue today's plan"), and due SRS reviews slot in on top. */
export function sessionIdsForDay(data: AppData, day: PlanDay): string[] {
  const t = todayKey();
  const dayExs = day.exerciseIds
    .map((id) => data.exercises.find((e) => e.id === id))
    .filter(Boolean) as Exercise[];
  const notDone = dayExs.filter((e) => e.reps === 0);
  const base = notDone.length > 0 ? notDone : dayExs; // all done → practise again
  const ids = base.map((e) => e.id); // the WHOLE remaining day — what the plan promises is what you get
  if (day.date <= t) {
    const due = data.exercises
      .filter((e) => e.reps > 0 && e.due <= t && !ids.includes(e.id) && !day.exerciseIds.includes(e.id))
      .sort((a, b) => (a.due < b.due ? -1 : 1))
      .slice(0, Math.max(3, Math.ceil(ids.length * 0.4)));
    ids.push(...due.map((e) => e.id));
  }
  return ids;
}

export const dayCompletion = (data: AppData, day: PlanDay) => {
  const exs = day.exerciseIds
    .map((id) => data.exercises.find((e) => e.id === id))
    .filter(Boolean) as Exercise[];
  if (exs.length === 0) return 1;
  return exs.filter((e) => e.reps > 0).length / exs.length;
};
