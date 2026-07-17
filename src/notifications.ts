import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false, shouldSetBadge: false,
    shouldShowBanner: true, shouldShowList: true,
  }),
});

/* One of these lands each day — scheduled per weekday so the message rotates. */
const LINES = [
  "Ten minutes of revision keeps the forgetting curve at bay ☕",
  "Your cards miss you. Marmalade does too. 🐱",
  "Little and often beats a lot and rarely — today's session is ready.",
  "Don't lose the streak! Today's revision is one tap away. 🔥",
  "A cuppa and a quick session? Lovely combination. 🫖",
  "Future-you will thank present-you for ten minutes today.",
  "Those phrasal verbs won't revise themselves… ⚡",
  "One small session today, one giant leap for your English. 🚀",
  "Quick quiz break? Your brain fancies a workout. 🧠",
  "Consistency is the whole trick — see you inside! 🎾",
];

const COMEBACK = [
  "Three days quiet — your streak freeze can only hold so long! Pop back for a quick session. 🐱",
  "Marmalade checked the calendar: it's been three days. Ten minutes tonight? 🫖",
  "Your concepts are drifting towards the forgetting curve — a short session brings them right back. 🔥",
];

const dailyId = (wd: number) => `swotly-daily-${wd}`;

async function cancelDaily() {
  for (let wd = 1; wd <= 7; wd++) {
    await Notifications.cancelScheduledNotificationAsync(dailyId(wd)).catch(() => {});
  }
}

/** Seven weekly notifications (one per weekday), each with a different line,
 *  so the same sentence never lands two days running. */
export async function scheduleDailyReminder(time: string): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return false;
  await cancelDaily();
  const [hour, minute] = time.split(":").map(Number);
  const off = Math.floor(Math.random() * LINES.length);
  for (let wd = 1; wd <= 7; wd++) {
    await Notifications.scheduleNotificationAsync({
      identifier: dailyId(wd),
      content: { title: "Swotly", body: LINES[(wd + off) % LINES.length] },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: wd, hour, minute },
    });
  }
  return true;
}

export async function cancelReminders() {
  await cancelDaily();
}

/** Dead-man's-switch comeback nudge: every app open re-arms a single
 *  notification 3 days ahead at 20:00 local. Use the app → it moves;
 *  stay away 3 days → it fires. */
export async function scheduleComebackNudge() {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") return;
    await Notifications.cancelScheduledNotificationAsync("swotly-comeback").catch(() => {});
    const d = new Date();
    d.setDate(d.getDate() + 3);
    d.setHours(20, 0, 0, 0);
    await Notifications.scheduleNotificationAsync({
      identifier: "swotly-comeback",
      content: { title: "Swotly", body: COMEBACK[Math.floor(Math.random() * COMEBACK.length)] },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: d },
    });
  } catch {}
}

/** Fire a sample nudge immediately so the user can see exactly what will arrive. */
export async function sendTestNudge(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return false;
  await Notifications.scheduleNotificationAsync({
    content: { title: "Swotly", body: LINES[Math.floor(Math.random() * LINES.length)] },
    trigger: null,
  });
  return true;
}
