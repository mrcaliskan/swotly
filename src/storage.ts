import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppData, emptyData } from "./types";
import { SELECTION_RE } from "./ai";

const KEY = "swotly:v1";

export async function loadData(): Promise<AppData> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw);
    if (!parsed.imgV3) { // one-time purge: switch to generated imagery
      parsed.concepts = (parsed.concepts ?? []).map((c: any) => ({ ...c, imageUrl: undefined }));
      parsed.imgV2 = true; parsed.imgV3 = true;
    }
    if (!parsed.oddFixV1) { // pre-v0.20 imports stored odd questions WITHOUT their options — unanswerable, purge
      parsed.exercises = (parsed.exercises ?? []).filter((e: any) =>
        e.type === "mcq" || e.type === "odd"
          ? (e.choices?.length ?? 0) >= 2
          : !SELECTION_RE.test(e.prompt ?? ""));
      parsed.oddFixV1 = true;
    }
    return { ...emptyData(), ...parsed, settings: { ...emptyData().settings, ...parsed.settings } };
  } catch {
    return emptyData();
  }
}

export async function saveData(data: AppData): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(data)); }
  catch (e) { console.error("save failed", e); }
}
