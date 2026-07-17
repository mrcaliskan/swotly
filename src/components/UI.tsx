import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Image, Pressable, Text, View, StyleSheet, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Ellipse, Path, Line, Polygon, G } from "react-native-svg";
import { C } from "../theme";

/* "Motion confirms the action" — every press springs back like Duolingo. */
export function Bounce({ children, onPress, disabled, style }: {
  children: React.ReactNode; onPress?: () => void; disabled?: boolean; style?: ViewStyle | ViewStyle[];
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPress={onPress} disabled={disabled} style={{ width: "100%" }}
      onPressIn={() => Animated.spring(scale, { toValue: 0.96, friction: 5, useNativeDriver: true }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start()}
    >
      <Animated.View style={[style, { transform: [{ scale }], width: "100%" }]}>{children}</Animated.View>
    </Pressable>
  );
}

export const shadow = {
  shadowColor: "#1C2B22", shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08, shadowRadius: 12, elevation: 3,
};

export function Btn({ label, onPress, kind = "pine", disabled, loading, style }: {
  label: string; onPress: () => void;
  kind?: "pine" | "marigold" | "ghost" | "danger"; disabled?: boolean; loading?: boolean; style?: ViewStyle;
}) {
  const bg = { pine: C.pine, marigold: C.clay, ghost: "transparent", danger: "transparent" }[kind];
  const fg = { pine: "#fff", marigold: "#FFF6F0", ghost: C.pine, danger: C.rose }[kind];
  const border = kind === "ghost" ? C.pine : kind === "danger" ? C.rose : "transparent";
  const lift = kind === "pine" || kind === "marigold" ? shadow : null;
  return (
    <Bounce onPress={onPress} disabled={disabled || loading}
      style={[s.btn, lift as any, { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.5 : 1 }, style as any]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, width: "100%" }}>
        {loading && <ActivityIndicator size="small" color={fg} />}
        <Text style={[s.btnText, { color: fg }]} numberOfLines={1}>{label}</Text>
      </View>
    </Bounce>
  );
}

export const Card = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
  <View style={[s.card, shadow, style]}>{children}</View>
);

export const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <Text style={s.eyebrow}>{children}</Text>
);

export const H1 = ({ children }: { children: React.ReactNode }) => (
  <Text style={s.h1}>{children}</Text>
);

export const H2 = ({ children }: { children: React.ReactNode }) => (
  <Text style={s.h2}>{children}</Text>
);

const ART_GRADS: Record<string, [string, string]> = {
  Grammar: ["#EDE7F6", "#CBB8EE"], Vocabulary: ["#DFF0DE", "#AFD8B4"],
  Pronunciation: ["#FBE4D4", "#F0BC9B"], Phrases: ["#F7ECD2", "#EAD095"],
  Other: ["#ECECEC", "#D5D5D5"],
};
/* Tier-1 visual: instant, offline, designed. A downloaded photo (file://)
   upgrades it automatically. */
export function ConceptVisual({ emoji, category, imageUrl, style }: {
  emoji?: string; category?: string; imageUrl?: string; style: ViewStyle | ViewStyle[];
}) {
  if (imageUrl && imageUrl.startsWith("file")) return <ImgLoad uri={imageUrl} style={style} />;
  const g = ART_GRADS[category ?? "Other"] ?? ART_GRADS.Other;
  return (
    <LinearGradient colors={g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[style as any, { overflow: "hidden", alignItems: "center", justifyContent: "center" }]}>
      <Text style={{ position: "absolute", fontSize: 110, opacity: 0.14, right: -18, bottom: -26 }}>{emoji || "📘"}</Text>
      <Text style={{ fontSize: 44 }}>{emoji || "📘"}</Text>
    </LinearGradient>
  );
}

/* Skeleton shimmer while a remote image loads — perceived speed. */
export function ImgLoad({ uri, style }: { uri: string; style: ViewStyle | ViewStyle[] }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.85, duration: 650, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.35, duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={[style as any, { overflow: "hidden", backgroundColor: C.sage }]}>
      {!loaded && !failed && (
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.line, opacity: pulse }]} />
      )}
      {failed ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
          <Text style={{ fontSize: 26, opacity: 0.4 }}>🖼️</Text>
        </View>
      ) : (
        <Image source={{ uri }} style={StyleSheet.absoluteFill as any}
          onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
      )}
    </View>
  );
}

/* Staggered entrance for dashboard cards. */
export function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 420, delay, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={{
      opacity: v,
      transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
    }}>{children}</Animated.View>
  );
}

/* Marmalade — the bespectacled ginger cat wizard, drawn as a real vector
   illustration (react-native-svg) rather than layering shapes over an emoji
   or requiring an image asset that could go missing from the bundle. `mood`
   only moves the wand + eyes (never the head/glasses geometry) so the frame
   never drifts out of alignment with the face. */
export function Mascot({ size = 34, mood = "idle" }: {
  size?: number; mood?: "idle" | "happy" | "sad" | "tip";
}) {
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 1400, useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 1400, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  const FUR = "#F0B37E", FUR_DARK = "#DE9257", CREAM = "#FCEFDC", INK = "#3B2A20", PINK = "#F4A9A0";
  const wandRotate = mood === "sad" ? 62 : mood === "happy" || mood === "tip" ? -46 : -24;
  const eyesShut = mood === "happy"; // ^‿^ — content, not startled
  return (
    <Animated.View style={{
      width: size * 1.5, height: size * 1.3, overflow: "hidden",
      transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -2.5] }) }],
    }}>
      <Svg width={size * 1.5} height={size * 1.3} viewBox="0 0 100 90">
        {/* wand, drawn first so it sits slightly behind the head's edge.
            Star kept close to the rotation origin (max ~17 units out) so it
            never swings past the viewBox edge (nearest edge is 22 units from
            the origin) at any of the three mood angles below. */}
        <G rotation={wandRotate} origin="78,64">
          <Path d="M75,62 L83,53" stroke="#9C6B22" strokeWidth={3.5} strokeLinecap="round" />
          <Polygon points="84,51 86,46 87,51 92,53 87,55 85,60 83,55 78,53 83,51" fill="#F2B705" />
        </G>
        {/* ears */}
        <Path d="M25,38 L15,12 L42,30 Z" fill={FUR_DARK} />
        <Path d="M75,38 L85,12 L58,30 Z" fill={FUR_DARK} />
        <Path d="M27,32 L21,17 L38,28 Z" fill={PINK} />
        <Path d="M73,32 L79,17 L62,28 Z" fill={PINK} />
        {/* head */}
        <Circle cx="50" cy="50" r="33" fill={FUR} />
        <Path d="M36,24 Q39,17 43,14" stroke={FUR_DARK} strokeWidth={3} strokeLinecap="round" fill="none" />
        <Path d="M64,24 Q61,17 57,14" stroke={FUR_DARK} strokeWidth={3} strokeLinecap="round" fill="none" />
        <Ellipse cx="50" cy="62" rx="17" ry="12" fill={CREAM} />
        {/* eyes */}
        {eyesShut ? (
          <>
            <Path d="M32,50 Q38,45 44,50" stroke={INK} strokeWidth={2.6} strokeLinecap="round" fill="none" />
            <Path d="M56,50 Q62,45 68,50" stroke={INK} strokeWidth={2.6} strokeLinecap="round" fill="none" />
          </>
        ) : (
          <>
            <Circle cx="38" cy="49" r="3.4" fill={INK} />
            <Circle cx="62" cy="49" r="3.4" fill={INK} />
          </>
        )}
        {/* nose + mouth */}
        <Polygon points="46,59 54,59 50,65" fill="#C75B2B" />
        <Path d="M50,65 Q45,71 39,67" stroke={INK} strokeWidth={2} strokeLinecap="round" fill="none" />
        <Path d="M50,65 Q55,71 61,67" stroke={INK} strokeWidth={2} strokeLinecap="round" fill="none" />
        {/* whiskers */}
        <Line x1="20" y1="58" x2="2" y2="55" stroke={INK} strokeWidth={1.4} strokeLinecap="round" />
        <Line x1="20" y1="63" x2="1" y2="64" stroke={INK} strokeWidth={1.4} strokeLinecap="round" />
        <Line x1="80" y1="58" x2="98" y2="55" stroke={INK} strokeWidth={1.4} strokeLinecap="round" />
        <Line x1="80" y1="63" x2="99" y2="64" stroke={INK} strokeWidth={1.4} strokeLinecap="round" />
        {/* round glasses, drawn last so they always frame the eyes on top */}
        <Circle cx="38" cy="49" r="13.5" fill="rgba(255,255,255,0.14)" stroke={INK} strokeWidth={3} />
        <Circle cx="62" cy="49" r="13.5" fill="rgba(255,255,255,0.14)" stroke={INK} strokeWidth={3} />
        <Line x1="51.5" y1="49" x2="48.5" y2="49" stroke={INK} strokeWidth={3} />
        <Line x1="24.5" y1="47" x2="16" y2="43" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
        <Line x1="75.5" y1="47" x2="84" y2="43" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}


const CAT_TONES: Record<string, { bg: string; fg: string }> = {
  Grammar: { bg: "#EDE7F6", fg: "#4F2D7F" },
  Vocabulary: { bg: "#E1EBDD", fg: "#0B5C33" },
  Pronunciation: { bg: "#F6E3D7", fg: "#C75B2B" },
  Phrases: { bg: "#F3E6D3", fg: "#8A5D14" },
  Other: { bg: "#E8E8E8", fg: "#555" },
};
/* deterministic identity colour per lesson — same lesson, same hue, app-wide */
const LESSON_PALETTE = [
  { fg: "#4F2D7F", bg: "#EDE7F6" }, // purple
  { fg: "#0B5C33", bg: "#E1EBDD" }, // pine
  { fg: "#C75B2B", bg: "#F3E6D3" }, // clay
  { fg: "#1D5F8A", bg: "#DFEDF6" }, // sea
  { fg: "#8A5D14", bg: "#F5EBD3" }, // amber
  { fg: "#A03A5E", bg: "#F6E2EA" }, // berry
];
export const lessonTone = (id?: string | null) => {
  if (!id) return LESSON_PALETTE[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return LESSON_PALETTE[h % LESSON_PALETTE.length];
};

export const catTone = (cat?: string) => CAT_TONES[cat ?? "Other"] ?? CAT_TONES.Other;

export const Chip = ({ children, tone }: { children: React.ReactNode; tone?: { bg: string; fg: string } }) => (
  <View style={[s.chip, tone && { backgroundColor: tone.bg }]}>
    <Text style={[s.chipText, tone && { color: tone.fg }]}>{children}</Text>
  </View>
);

const s = StyleSheet.create({
  btn: { borderRadius: 16, paddingVertical: 16, paddingHorizontal: 12, alignItems: "center", borderWidth: 1.5 },
  btnText: { fontSize: 16, fontWeight: "700" },
  card: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 22, padding: 18 },
  eyebrow: { fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: C.muted, fontWeight: "700" },
  h1: { fontSize: 32, fontWeight: "800", color: C.ink, marginTop: 6, marginBottom: 4, letterSpacing: -0.5 },
  h2: { fontSize: 20, fontWeight: "700", color: C.ink, letterSpacing: -0.2 },
  chip: { backgroundColor: C.purpleBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
  chipText: { fontSize: 12, fontWeight: "700", color: C.purple },
});
