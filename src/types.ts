export type Category = "Grammar" | "Vocabulary" | "Pronunciation" | "Phrases" | "Other";
export type ExerciseType = "flashcard" | "mcq" | "gap" | "type" | "listen" | "odd" | "fix" | "stress";
export type Grade = "again" | "hard" | "good" | "easy";
export type LearningStyle = "learn" | "quiz";

export interface Lesson {
  id: string;
  label: string;
  date: string;         // yyyy-mm-dd
}

export interface Concept {
  id: string;
  lessonId: string;
  title: string;
  category: Category;
  summary: string;
  tip: string;
  emoji: string;           // visual mnemonic, e.g. "🌧️☂️"
  example: string;         // natural example sentence
  imageQuery: string;      // 1-3 words for photo search
  imageUrl?: string;       // cached Pexels photo
  weekLabel: string;
  seenCount: number;
  createdOn: string;
  shelved?: boolean; // "remind me later" review shelf
}

export interface Exercise {
  id: string;
  conceptId: string;
  type: ExerciseType;
  prompt: string;
  answer: string;
  choices?: string[];
  hint?: string;
  domain?: string;       // everyday scenario tag from generation (work, travel…) — used to space out consecutive session questions
  ease: number;
  interval: number;
  due: string;
  reps: number;
  lapses: number;
}

export interface Story {
  id: string;
  lessonId: string;
  conceptIds: string[];
  text: string;        // paragraph with blanks written as [1] [2] [3]
  answers: string[];   // answers[i] fills [i+1]
}

export interface ResultEntry {
  exId: string; grade: Grade; correct: boolean; cat: Category; prompt: string;
  skipped?: boolean;
}

export interface PendingSession {
  ids: string[];           // exercise ids in order
  stepIdx: number;         // resume position in the derived step list
  results: ResultEntry[];
  style: LearningStyle;
}

export interface SessionLog {
  date: string; done: number; correct: number; minutes: number; xp: number;
  concepts: string[];      // concept titles touched
}

export interface PlanDay {
  date: string;             // yyyy-mm-dd
  conceptIds: string[];
  exerciseIds: string[];
}
export interface StudyPlan {
  createdOn: string;
  startDate: string;
  days: PlanDay[];
}

export interface AppData {
  lessons: Lesson[];
  concepts: Concept[];
  exercises: Exercise[];
  sessions: SessionLog[];
  settings: {
    minutes: number; reminderOn: boolean; reminderTime: string;
    learningStyle: LearningStyle | null;
    voice: string; // gb | us | device
    sound?: boolean; // auto-speech on/off (manual speaker taps always work)
  };
  streak: { count: number; lastDate: string | null };
  xp: number;
  freezes: number;          // streak freezes ❄️ — earned every 7-day streak
  studyPlan: StudyPlan | null;
  stories?: Story[];
  lastChest?: string; // date the daily reward chest was last opened
  imgV2?: boolean;
  imgV3?: boolean;
  oddFixV1?: boolean;
  pending: PendingSession | null;
}

export const emptyData = (): AppData => ({
  lessons: [],
  concepts: [],
  exercises: [],
  sessions: [],
  settings: { minutes: 10, reminderOn: false, reminderTime: "18:00", learningStyle: null, voice: "gb" },
  streak: { count: 0, lastDate: null },
  xp: 0,
  freezes: 0,
  studyPlan: null,
  stories: [],
  lastChest: undefined,
  imgV2: true,
  imgV3: true,
  oddFixV1: true,
  pending: null,
});

export const LEVELS = [0, 250, 600, 1100, 1800, 2700, 3800, 5200, 7000, 9200];
export const levelFor = (xp: number) => {
  let lvl = 1;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i]) lvl = i + 1;
  return lvl;
};
export const nextLevelAt = (xp: number) => {
  for (const t of LEVELS) if (xp < t) return t;
  return LEVELS[LEVELS.length - 1];
};

export const CATEGORIES: Category[] = ["Grammar", "Vocabulary", "Pronunciation", "Phrases", "Other"];
export const todayKey = () => new Date().toISOString().slice(0, 10);
export const daysFromNow = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export const LEVEL_TITLES = [
  "Fresher", "Keen Bean", "Swot", "Scholar", "Wordsmith",
  "Phrase Fancier", "Grammar Gent", "Fluent Fox", "Centre Court Champ", "C2 Legend",
];
export const levelTitle = (xp: number) => LEVEL_TITLES[Math.min(levelFor(xp) - 1, LEVEL_TITLES.length - 1)];
