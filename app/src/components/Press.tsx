/**
 * A pressable that responds the instant it is touched.
 *
 * The moment feedback waits for touch-UP, directness falls off a cliff — the
 * control feels dead even though nothing is slow. So the scale change starts on
 * touch-DOWN, and the action still commits on release, which also preserves the
 * ability to slide off and cancel.
 *
 * The spring is critically damped: a button that wobbles after a press is
 * drawing attention to itself rather than to the work.
 *
 * Native driver throughout, so the animation runs on the UI thread and does not
 * stutter while the engine is resolving a scan on the JS thread.
 */
import React, { useRef } from 'react';
import { Animated, Pressable, StyleProp, ViewStyle, AccessibilityRole } from 'react-native';
import { SPRING } from '../theme';

interface Props {
  onPress?: () => void;
  onLongPress?: () => void;
  delayLongPress?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  /** How far it gives under the finger. Big surfaces move less. */
  depth?: number;
  hitSlop?: number;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
}

export default function Press({
  onPress, onLongPress, delayLongPress, disabled, style, children,
  depth = 0.97, hitSlop = 8, accessibilityLabel, accessibilityRole = 'button',
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  // Interruptible by construction: a spring re-targets from wherever the value
  // currently is, so a fast double press does not jump or queue up.
  const to = (v: number) => Animated.spring(scale, { toValue: v, ...SPRING.press }).start();

  return (
    <Pressable
      onPressIn={() => to(depth)}
      onPressOut={() => to(1)}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
