import React, { useEffect, useState } from "react";
import {
  Alert, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { AppData, emptyData } from "../types";
import { saveData } from "../storage";
import { getApiKey, setApiKey, clearApiKey } from "../ai";
import { getPolliKey, setPolliKey, clearPolliKey } from "../netq";
import { readImgLog, localizeImagesInBackground } from "../images";
import { loadData } from "../storage";
import { initSpeech, speak, setVoice, VoiceId } from "../speech";
import { scheduleDailyReminder, cancelReminders, sendTestNudge } from "../notifications";
import { Btn, Eyebrow, H1 } from "../components/UI";
import { C } from "../theme";

export default function SettingsScreen({ data, setData }: {
  data: AppData; setData: (d: AppData) => void;
}) {
  const [keyDraft, setKeyDraft] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [polDraft, setPolDraft] = useState("");
  const [showAdv, setShowAdv] = useState(false);
  const [showTimePick, setShowTimePick] = useState(false);
  const [imgRep, setImgRep] = useState<any>(null);
  const [hasPol, setHasPol] = useState(false);

  useEffect(() => {
    getApiKey().then((k) => setHasKey(!!k));
    getPolliKey().then((k) => setHasPol(!!k));
    readImgLog().then(setImgRep);
  }, []);

  const set = async (patch: Partial<AppData["settings"]>) => {
    const next = { ...data, settings: { ...data.settings, ...patch } };
    setData(next); await saveData(next);
    return next;
  };

  const toggleReminder = async (on: boolean) => {
    if (on) {
      const ok = await scheduleDailyReminder(data.settings.reminderTime);
      if (!ok) {
        Alert.alert("Notifications are off", "Allow notifications for Swotly in iPhone Settings, then try again.");
        return;
      }
    } else {
      await cancelReminders();
    }
    await set({ reminderOn: on });
  };

  const changeTime = async (time: string) => {
    const next = await set({ reminderTime: time });
    if (next.settings.reminderOn) await scheduleDailyReminder(time);
  };

  const saveKey = async () => {
    if (!keyDraft.trim().startsWith("sk-ant-")) {
      Alert.alert("That doesn't look right", "Anthropic API keys start with sk-ant-…");
      return;
    }
    await setApiKey(keyDraft); setKeyDraft(""); setHasKey(true);
  };

  return (
    <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      <Eyebrow>Make it yours</Eyebrow>
      <H1>Settings</H1>

      <Text style={s.label}>Revision style</Text>
      <View style={s.pillRow}>
        {([["learn", "🎓 Teach me first"], ["quiz", "⚡ Straight to questions"]] as const).map(([v, lab]) => (
          <TouchableOpacity key={v} onPress={() => set({ learningStyle: v })}
            style={[s.pill, data.settings.learningStyle === v && s.pillOn]}>
            <Text style={[s.pillText, data.settings.learningStyle === v && s.pillTextOn]}>{lab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.note}>Applies instantly — even to a session you resume.</Text>

      <Text style={s.label}>Daily reminder</Text>
      <View style={s.row}>
        <TouchableOpacity onPress={() => setShowTimePick(true)} style={s.timeField}>
          <Text style={s.timeBig}>🔔 {data.settings.reminderTime}</Text>
          <Text style={{ fontSize: 13, color: C.muted, fontWeight: "800" }}>▾</Text>
        </TouchableOpacity>
        <Switch
          value={data.settings.reminderOn} onValueChange={toggleReminder}
          trackColor={{ true: C.pine }} style={{ marginLeft: 12 }}
        />
      </View>
      <Modal visible={showTimePick} transparent animationType="slide" onRequestClose={() => setShowTimePick(false)}>
        <TouchableOpacity style={s.modalDim} activeOpacity={1} onPress={() => setShowTimePick(false)}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Remind me at…</Text>
            <ScrollView style={{ maxHeight: 340 }}>
              {Array.from({ length: 36 }, (_, i) => {
                const h = Math.floor(i / 2) + 6, mm = i % 2 === 0 ? "00" : "30";
                const tv = `${String(h).padStart(2, "0")}:${mm}`;
                const on = data.settings.reminderTime === tv;
                return (
                  <TouchableOpacity key={tv} style={[s.timeOpt, on && s.timeOptOn]}
                    onPress={() => { changeTime(tv); setShowTimePick(false); }}>
                    <Text style={[s.timeOptText, on && { color: "#fff" }]}>{tv}</Text>
                    {on && <Text style={{ color: "#fff", fontWeight: "900" }}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
      <Text style={s.note}>One of ten different nudges arrives at this time each day.</Text>
      <TouchableOpacity onPress={async () => {
          const ok = await sendTestNudge();
          if (!ok) Alert.alert("Notifications are off", "Allow notifications for Swotly in iOS Settings to receive nudges.");
        }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ marginTop: 10, alignSelf: "flex-start" }}>
        <Text style={s.testNudgeLink}>Send a test nudge 🔔</Text>
      </TouchableOpacity>

      <Text style={s.label}>Voice</Text>
      <View style={s.pillRow}>
        {([
          ["gb", "🇬🇧 British"], ["us", "🇺🇸 American"], ["device", "📱 Device"],
        ] as [VoiceId, string][]).map(([v, lab]) => (
          <TouchableOpacity key={v}
            onPress={async () => {
              await set({ voice: v } as any);
              await initSpeech(); setVoice(v);
              speak("Lovely to hear you. Shall we get some revision done?", 12000);
            }}
            style={[s.pill, (data.settings.voice ?? "gb") === v && s.pillOn]}>
            <Text style={[s.pillText, (data.settings.voice ?? "gb") === v && s.pillTextOn]}>{lab}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={s.note}>
        British and American stream free from the cloud and cache after first
        play; if the network stalls, the device voice covers the line. Never
        silence.
      </Text>

      <TouchableOpacity onPress={() => setShowAdv((v) => !v)}>
        <Text style={s.label}>{showAdv ? "▾" : "▸"}  Advanced — API keys & picture pipeline</Text>
      </TouchableOpacity>
      {!showAdv && <Text style={s.note}>Technical settings most people never need. Tap to open.</Text>}
      {showAdv && (<>
      <Text style={s.label}>Picture pipeline</Text>
      <Btn label="Run picture fetch now" kind="ghost" onPress={async () => {
        localizeImagesInBackground(loadData, saveData, () => {});
        setTimeout(async () => setImgRep(await readImgLog()), 8000);
      }} />
      {imgRep ? (
        <Text style={s.note}>
          Last run {imgRep.at}: {imgRep.targets} targets · {imgRep.cands} candidates ·
          {" "}{imgRep.verified} approved · {imgRep.saved} saved{imgRep.err ? ` · err: ${imgRep.err}` : ""}
        </Text>
      ) : <Text style={s.note}>No run recorded yet.</Text>}

      <Text style={s.label}>Faster pictures & voice (optional)</Text>
      {hasPol ? (
        <View>
          <Text style={s.note}>✓ Pollinations key saved — generation runs at full pace.</Text>
          <Btn label="Remove Pollinations key" kind="danger" style={{ marginTop: 10 }}
            onPress={async () => { await clearPolliKey(); setHasPol(false); }} />
        </View>
      ) : (
        <View>
          <TextInput style={s.field} value={polDraft} onChangeText={setPolDraft}
            placeholder="Pollinations key (free)" placeholderTextColor={C.muted}
            autoCapitalize="none" autoCorrect={false} />
          <Text style={s.note}>
            Free at enter.pollinations.ai. Without it Swotly still works — it just
            paces requests politely (one every ~6s), so pictures arrive slower.
          </Text>
          <Btn label="Save Pollinations key" onPress={async () => {
            if (!polDraft.trim()) return;
            await setPolliKey(polDraft); setPolDraft(""); setHasPol(true);
          }} disabled={!polDraft.trim()} style={{ marginTop: 10 }} />
        </View>
      )}

      <Text style={s.label}>Anthropic API key</Text>
      {hasKey ? (
        <View>
          <Text style={s.note}>✓ Key saved securely in your iPhone's keychain.</Text>
          <Btn label="Remove key" kind="danger" style={{ marginTop: 10 }}
            onPress={async () => { await clearApiKey(); setHasKey(false); }} />
        </View>
      ) : (
        <View>
          <TextInput
            style={s.field} value={keyDraft} onChangeText={setKeyDraft}
            placeholder="sk-ant-…" placeholderTextColor={C.muted}
            autoCapitalize="none" autoCorrect={false} secureTextEntry
          />
          <Text style={s.note}>
            Get one at console.anthropic.com → API keys. It never leaves your
            device except to call the API directly.
          </Text>
          <Btn label="Save key" onPress={saveKey} disabled={!keyDraft.trim()} style={{ marginTop: 10 }} />
        </View>
      )}

      </>)}

      <Text style={s.label}>Danger zone</Text>
      <Btn
        label="Reset all data" kind="danger"
        onPress={() =>
          Alert.alert("Reset everything?", "This wipes all concepts, exercises and progress.", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Reset", style: "destructive",
              onPress: async () => { const next = emptyData(); setData(next); await saveData(next); },
            },
          ])
        }
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  timeField: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1.5, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: C.card },
  modalDim: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: C.paper, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 34 },
  modalTitle: { fontSize: 16, fontWeight: "900", color: C.ink, marginBottom: 10 },
  timeOpt: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, marginBottom: 4, backgroundColor: C.card },
  timeOptOn: { backgroundColor: C.pine },
  timeOptText: { fontSize: 15, fontWeight: "700", color: C.ink, fontVariant: ["tabular-nums"] },
  timeBig: { fontSize: 22, fontWeight: "900", color: C.ink, flex: 1 },
  timeChip: { borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, marginRight: 8, backgroundColor: C.card },
  timeChipOn: { backgroundColor: C.pine, borderColor: C.pine },
  timeChipText: { fontSize: 14, fontWeight: "700", color: C.ink, fontVariant: ["tabular-nums"] },
  timeChipTextOn: { color: "#fff" },
  wrap: { padding: 18, paddingBottom: 40 },
  label: { fontSize: 13, fontWeight: "700", color: C.ink, marginTop: 22, marginBottom: 8 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    borderWidth: 1.5, borderColor: C.line, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.card,
  },
  pillOn: { backgroundColor: C.pine, borderColor: C.pine },
  pillText: { fontSize: 14, fontWeight: "700", color: C.muted },
  pillTextOn: { color: "#fff" },
  row: { flexDirection: "row", alignItems: "center" },
  field: {
    borderWidth: 1.5, borderColor: C.line, borderRadius: 12, padding: 13,
    fontSize: 15, backgroundColor: C.card, color: C.ink,
  },
  note: { fontSize: 12.5, color: C.muted, marginTop: 8, lineHeight: 18 },
  testNudgeLink: { fontSize: 13.5, fontWeight: "700", color: C.pine },
});
