import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { AppData, LearningStyle } from "../types";
import { saveData } from "../storage";
import { setApiKey } from "../ai";
import { Btn, Mascot } from "../components/UI";
import { C } from "../theme";

export default function OnboardingScreen({ data, setData, onFinished }: {
  data: AppData; setData: (d: AppData) => void; onFinished: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [style, setStyle] = useState<LearningStyle>("learn");
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");

  const finish = async () => {
    if (key.trim()) {
      if (!key.trim().startsWith("sk-ant-")) {
        setErr("Anthropic keys start with sk-ant-… (or skip for now)"); return;
      }
      await setApiKey(key);
    }
    onFinished(); // App switches to the Add screen…
    const next = { ...data, settings: { ...data.settings, learningStyle: style } };
    setData(next); await saveData(next); // …then the gate closes
  };

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Mascot size={58} />
      <Text style={s.brand}>swotly</Text>
      <Text style={s.tagline}>Your lessons, remembered for good.</Text>

      <View style={s.dots}>
        <View style={[s.dot, step === 1 && s.dotOn]} />
        <View style={[s.dot, step === 2 && s.dotOn]} />
      </View>

      {step === 1 ? (
        <>
          <View style={s.props}>
            <Prop icon="📚" text="Drop in your lesson notes — paste, PDF or photo. Swotly turns them into exercises." />
            <Prop icon="🧠" text="A daily plan, built by spaced repetition, brings everything back just before you'd forget it." />
            <Prop icon="🎾" text="Streaks, combos and a proper British voice keep the ten minutes a day rather lovely." />
          </View>
          <Text style={s.question}>How do you like to revise?</Text>
          <Btn label="🎓 Teach me first" kind={style === "learn" ? "marigold" : "ghost"}
            onPress={() => setStyle("learn")} style={{ marginTop: 8, alignSelf: "stretch" }} />
          <Btn label="⚡ Straight to questions" kind={style === "quiz" ? "marigold" : "ghost"}
            onPress={() => setStyle("quiz")} style={{ marginTop: 10, alignSelf: "stretch" }} />
          <Btn label="Continue →" onPress={() => setStep(2)} style={{ marginTop: 22, alignSelf: "stretch" }} />
          <Text style={s.small}>You can change this any time in Settings.</Text>
        </>
      ) : (
        <>
          <Text style={s.question}>One key unlocks the magic</Text>
          <Text style={s.keyNote}>
            Swotly analyses your notes with Claude. Grab a key at
            console.anthropic.com → API Keys — it stays in your iPhone's keychain.
          </Text>
          <TextInput
            style={s.field} value={key} onChangeText={setKey}
            placeholder="sk-ant-…" placeholderTextColor={C.muted}
            autoCapitalize="none" autoCorrect={false} secureTextEntry
          />
          {err ? <Text style={s.err}>{err}</Text> : null}
          <Btn label="Save & add my first lesson" kind="marigold"
            onPress={finish} style={{ marginTop: 14, alignSelf: "stretch" }} />
          <TouchableOpacity onPress={() => { setKey(""); finish(); }}
            hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }}>
            <Text style={s.small}>Skip for now — add it later in Settings</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const Prop = ({ icon, text }: { icon: string; text: string }) => (
  <View style={s.prop}>
    <Text style={{ fontSize: 24 }}>{icon}</Text>
    <Text style={s.propText}>{text}</Text>
  </View>
);

const s = StyleSheet.create({
  wrap: { padding: 26, paddingTop: 64, alignItems: "center" },
  brand: { fontSize: 34, fontWeight: "800", color: C.pine, letterSpacing: 1, marginTop: 6 },
  tagline: { fontSize: 15.5, color: C.muted, marginTop: 6 },
  dots: { flexDirection: "row", gap: 8, marginTop: 18 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.line },
  dotOn: { backgroundColor: C.clay, width: 22 },
  props: { marginTop: 22, gap: 14, alignSelf: "stretch" },
  prop: {
    flexDirection: "row", gap: 14, alignItems: "center",
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 15,
  },
  propText: { flex: 1, fontSize: 14, color: C.ink, lineHeight: 20 },
  question: { fontSize: 17, fontWeight: "800", color: C.ink, marginTop: 26, marginBottom: 6 },
  keyNote: { fontSize: 13.5, color: C.muted, lineHeight: 20, textAlign: "center", marginBottom: 14 },
  field: {
    alignSelf: "stretch", borderWidth: 1.5, borderColor: C.line, borderRadius: 12,
    padding: 13, fontSize: 15, backgroundColor: C.card, color: C.ink,
  },
  err: { color: C.rose, fontSize: 13, marginTop: 8 },
  small: { fontSize: 12.5, color: C.muted, marginTop: 14 },
});
