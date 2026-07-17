import { Exercise, Grade, daysFromNow } from "./types";

/** SM-2, simplified. "again" resurfaces today; "easy" pushes far out. */
export function gradeExercise(ex: Exercise, grade: Grade): Exercise {
  let { ease, interval, reps, lapses } = ex;
  if (grade === "again") {
    interval = 0; ease = Math.max(1.3, ease - 0.2); lapses += 1; reps += 1;
  } else if (grade === "hard") {
    interval = Math.max(1, Math.round(Math.max(interval, 1) * 1.2));
    ease = Math.max(1.3, ease - 0.15); reps += 1;
  } else if (grade === "good") {
    interval = interval === 0 ? 1 : Math.round(interval * ease); reps += 1;
  } else {
    interval = interval === 0 ? 2 : Math.round(interval * ease * 1.3);
    ease = Math.min(2.8, ease + 0.15); reps += 1;
  }
  return { ...ex, ease, interval, reps, lapses, due: daysFromNow(interval) };
}

/** Map an auto-marked answer to an SRS grade. */
export const autoGrade = (correct: boolean): Grade => (correct ? "good" : "again");
