import React, { useEffect, useRef, useState } from "react";
import { Animated, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { AppData, PendingSession } from "./src/types";
import { loadData, saveData } from "./src/storage";
import { localizeImagesInBackground } from "./src/images";
import { scheduleComebackNudge } from "./src/notifications";
import { C } from "./src/theme";
import { Mascot } from "./src/components/UI";
import OnboardingScreen from "./src/screens/OnboardingScreen";
import HomeScreen from "./src/screens/HomeScreen";
import PractiseScreen from "./src/screens/PractiseScreen";
import AddNotesScreen from "./src/screens/AddNotesScreen";
import SessionScreen from "./src/screens/SessionScreen";
import LibraryScreen from "./src/screens/LibraryScreen";
import SettingsScreen from "./src/screens/SettingsScreen";

const LEFT_TABS: [string, string, string][] = [
  ["home", "Home", "🏠"],
  ["practise", "Plan", "🗓"],
];
const RIGHT_TABS: [string, string, string][] = [
  ["library", "Library", "📚"],
  ["settings", "Settings", "⚙️"],
];

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [view, setView] = useState("home");
  const [lessonFocus, setLessonFocus] = useState<{ id: string } | null>(null);
  const [session, setSession] = useState<PendingSession | null>(null);
  const [splashDone, setSplashDone] = useState(false);
  const owlScale = useRef(new Animated.Value(0.4)).current;
  const owlFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadData().then((d) => {
      setData(d);
      localizeImagesInBackground(loadData, saveData, setData); // finish any pending pictures
      scheduleComebackNudge(); // re-arm the 3-day inactivity nudge (20:00)
    });
    Animated.parallel([
      Animated.spring(owlScale, { toValue: 1, friction: 4, tension: 60, useNativeDriver: true }),
      Animated.timing(owlFade, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(() => setSplashDone(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!data || !splashDone) {
    return (
      <LinearGradient colors={["#0B5C33", "#084425", "#062F1A"]} style={[{ flex: 1 }, s.center]}>
        <Animated.View accessible={false} style={{ opacity: owlFade, transform: [{ scale: owlScale }] }}>
          <Mascot size={72} />
        </Animated.View>
        <Animated.Text style={[s.splashBrand, { opacity: owlFade }]}>swotly</Animated.Text>
        <Animated.Text style={[s.splashTag, { opacity: owlFade }]}>Your lessons, remembered for good.</Animated.Text>
      </LinearGradient>
    );
  }

  if (data.settings.learningStyle === null) {
    return (
      <SafeAreaView style={s.root}>
        <StatusBar style="dark" />
        <OnboardingScreen data={data} setData={setData} onFinished={() => setView("add")} />
      </SafeAreaView>
    );
  }

  const startSession = (p: PendingSession) => { setSession(p); setView("session"); };

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />
      {view !== "session" && (
        <View style={s.header}><Text style={s.brand}>swotly</Text></View>
      )}
      <View style={{ flex: 1 }}>
        {view === "home" && <HomeScreen data={data} setData={setData} go={setView} startSession={startSession} openLesson={(id: string) => { setLessonFocus({ id }); setView("practise"); }} />}
        {view === "practise" && <PractiseScreen data={data} setData={setData} go={setView} startSession={startSession} lessonFocus={lessonFocus} />}
        {view === "add" && <AddNotesScreen data={data} setData={setData} go={setView} />}
        {view === "library" && <LibraryScreen data={data} setData={setData} startSession={startSession} />}
        {view === "settings" && <SettingsScreen data={data} setData={setData} />}
        {view === "session" && session && (
          <SessionScreen data={data} setData={setData} pending={session} exit={() => setView("home")} />
        )}
      </View>
      {view !== "session" && (
        <View style={s.nav}>
          {LEFT_TABS.map(([k, label, icon]) => (
            <TouchableOpacity key={k} style={s.tab}
              onPress={() => { Haptics.selectionAsync(); setView(k); }}>
              <View style={[s.tabInner, view === k && s.tabInnerOn]}>
                <Text style={[s.tabIcon, view === k && s.tabOn]}>{icon}</Text>
                <Text style={[s.tabLabel, view === k && s.tabOn]}>{label}</Text>
              </View>
            </TouchableOpacity>
          ))}
          <View style={s.tab}>
            <TouchableOpacity style={s.fab} onPress={() => setView("add")} activeOpacity={0.85}
              accessibilityRole="button" accessibilityLabel="Add a new lesson">
              <Text style={s.fabPlus}>＋</Text>
            </TouchableOpacity>
            <Text style={[s.tabLabel, view === "add" && s.tabOn]}>Add</Text>
          </View>
          {RIGHT_TABS.map(([k, label, icon]) => (
            <TouchableOpacity key={k} style={s.tab}
              onPress={() => { Haptics.selectionAsync(); setView(k); }}>
              <View style={[s.tabInner, view === k && s.tabInnerOn]}>
                <Text style={[s.tabIcon, view === k && s.tabOn]}>{icon}</Text>
                <Text style={[s.tabLabel, view === k && s.tabOn]}>{label}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  center: { alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 18, paddingTop: 8 },
  brand: { fontSize: 17, fontWeight: "700", color: C.pine, letterSpacing: 1 },
  splashOwl: { fontSize: 72 },
  splashBrand: { fontSize: 34, fontWeight: "800", color: "#F2F7F1", letterSpacing: 1, marginTop: 10 },
  splashTag: { fontSize: 14, color: "#BFD6C4", marginTop: 8 },
  fab: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: C.clay,
    alignItems: "center", justifyContent: "center", marginTop: -26,
    shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25,
    shadowRadius: 10, elevation: 8, borderWidth: 3, borderColor: C.card,
  },
  fabPlus: { color: "#fff", fontSize: 30, fontWeight: "700", marginTop: -2 },
  loading: { color: C.muted, marginTop: 8 },
  resumeBar: { backgroundColor: C.purple, marginHorizontal: 14, marginBottom: 8, borderRadius: 16, padding: 12 },
  resumeText: { color: "#fff", fontWeight: "800", fontSize: 13.5, textAlign: "center" },
  nav: {
    flexDirection: "row", backgroundColor: C.card,
    marginHorizontal: 14, marginBottom: 6, borderRadius: 28,
    paddingVertical: 8, paddingHorizontal: 6,
    shadowColor: "#1C2B22", shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12, shadowRadius: 14, elevation: 6,
    borderWidth: 1, borderColor: C.line,
  },
  tab: { flex: 1, alignItems: "center", gap: 2 },
  tabInner: { alignItems: "center", gap: 2, borderRadius: 16, paddingVertical: 5, paddingHorizontal: 12 },
  tabInnerOn: { backgroundColor: C.sage },
  tabIcon: { fontSize: 18, color: C.muted },
  tabLabel: { fontSize: 10.5, fontWeight: "700", color: C.muted },
  tabOn: { color: C.pine },
});
