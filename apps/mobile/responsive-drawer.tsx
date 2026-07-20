import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResponsiveLayout } from "./responsive-layout";

type Props = {
  children: ReactNode;
  forceHidden?: boolean;
  onClose: () => void;
  open: boolean;
  status?: string | null;
  title: string;
};

const ANIMATION_DURATION_MS = 360;

export function ResponsiveDrawer({
  children,
  forceHidden = false,
  onClose,
  open,
  status,
  title,
}: Props) {
  const { isTablet, width } = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const [rendered, setRendered] = useState(open);
  const drawerWidth = Math.min(isTablet ? 440 : 380, Math.max(280, width - 24));

  useEffect(() => {
    if (forceHidden) {
      progress.stopAnimation();
      progress.setValue(0);
      setRendered(false);
      return;
    }

    if (open) {
      setRendered(true);
      progress.stopAnimation();
      Animated.timing(progress, {
        duration: ANIMATION_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }).start();
      return;
    }

    progress.stopAnimation();
    Animated.timing(progress, {
      duration: ANIMATION_DURATION_MS,
      easing: Easing.inOut(Easing.cubic),
      toValue: 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setRendered(false);
    });
  }, [forceHidden, open, progress]);

  if (!rendered || forceHidden) return null;

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [drawerWidth, 0],
  });

  return (
    <Modal
      animationType="none"
      navigationBarTranslucent
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={rendered}
    >
      <View accessibilityViewIsModal style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: progress }]}>
          <Pressable
            accessibilityLabel="Close household menu"
            accessibilityRole="button"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.drawer,
            {
              paddingBottom: Math.max(insets.bottom, 16),
              paddingTop: Math.max(insets.top, 16),
              transform: [{ translateX }],
              width: drawerWidth,
            },
          ]}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.keyboardView}
          >
            <View style={styles.header}>
              <Text accessibilityRole="header" style={styles.title}>{title}</Text>
              <Pressable
                accessibilityLabel="Close household menu"
                accessibilityRole="button"
                hitSlop={10}
                onPress={onClose}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          </KeyboardAvoidingView>
          {status ? (
            <View
              accessibilityLiveRegion="polite"
              pointerEvents="none"
              style={[styles.toast, { bottom: Math.max(insets.bottom + 12, 18) }]}
            >
              <Text style={styles.toastText}>{status}</Text>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  backdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.62)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  drawer: {
    alignSelf: "flex-end",
    backgroundColor: "#111111",
    borderLeftColor: "#44403c",
    borderLeftWidth: 1,
    elevation: 24,
    height: "100%",
    maxWidth: "100%",
    paddingHorizontal: 18,
    shadowColor: "#000",
    shadowOffset: { height: 0, width: -8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    borderBottomColor: "#292524",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingBottom: 14,
  },
  title: {
    color: "#fafaf9",
    flex: 1,
    fontSize: 22,
    fontWeight: "700",
  },
  closeButton: {
    alignItems: "center",
    borderColor: "#57534e",
    borderRadius: 18,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  closeText: {
    color: "#fafaf9",
    fontSize: 30,
    lineHeight: 32,
  },
  pressed: {
    opacity: 0.72,
  },
  content: {
    gap: 18,
    paddingBottom: 8,
    paddingTop: 18,
  },
  toast: {
    alignSelf: "center",
    backgroundColor: "#292524",
    borderColor: "#fbbf24",
    borderRadius: 16,
    borderWidth: 1,
    left: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    position: "absolute",
    right: 14,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    zIndex: 20,
  },
  toastText: {
    color: "#fef3c7",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
