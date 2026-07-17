import React, { useEffect, useRef } from "react";
import { Animated, Dimensions, StyleSheet, View } from "react-native";

const COLOURS = ["#C75B2B", "#0B5C33", "#4F2D7F", "#E8A33D", "#7FB069"];
const PIECES = 18;

export default function Confetti() {
  const anims = useRef(
    [...Array(PIECES)].map(() => ({
      fall: new Animated.Value(0),
      x: Math.random() * Dimensions.get("window").width,
      delay: Math.random() * 600,
      size: 7 + Math.random() * 7,
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
      drift: (Math.random() - 0.5) * 80,
      spin: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    anims.forEach((p) => {
      Animated.timing(p.fall, {
        toValue: 1, duration: 2200 + Math.random() * 800,
        delay: p.delay, useNativeDriver: true,
      }).start();
      Animated.loop(
        Animated.timing(p.spin, { toValue: 1, duration: 700 + Math.random() * 500, useNativeDriver: true })
      ).start();
    });
  }, []);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {anims.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute", left: p.x, top: -20,
            width: p.size, height: p.size * 0.6, borderRadius: 2,
            backgroundColor: p.colour,
            transform: [
              { translateY: p.fall.interpolate({ inputRange: [0, 1], outputRange: [0, 620] }) },
              { translateX: p.fall.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
              { rotate: p.spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
            ],
            opacity: p.fall.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
          }}
        />
      ))}
    </View>
  );
}
