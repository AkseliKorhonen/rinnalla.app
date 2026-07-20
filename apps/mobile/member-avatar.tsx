import { Image, StyleSheet, Text, View } from "react-native";

type Props = {
  image: string | null | undefined;
  label: string;
  size?: number;
};

function initials(label: string) {
  const parts = label
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function MemberAvatar({ image, label, size = 48 }: Props) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.avatar,
        { borderRadius: size / 2, height: size, width: size },
      ]}
    >
      {image ? (
        <Image resizeMode="cover" source={{ uri: image }} style={styles.image} />
      ) : (
        <Text style={[styles.initials, { fontSize: Math.max(12, size * 0.34) }]}>
          {initials(label)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    backgroundColor: "#292524",
    borderColor: "#57534e",
    borderWidth: 1,
    justifyContent: "center",
    overflow: "hidden",
  },
  image: {
    height: "100%",
    width: "100%",
  },
  initials: {
    color: "#fef3c7",
    fontWeight: "700",
  },
});
