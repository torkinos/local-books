/**
 * T5 placeholder screen.
 *
 * Deliberately does one non-trivial thing: it calls into @local-books/core and
 * renders the result, so a successful launch on a device proves the monorepo wiring
 * -- Metro resolving the workspace package, TypeScript transpiling core's source,
 * and bigint arithmetic working on Hermes -- not just that React Native boots.
 */
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { formatUnits } from '@local-books/core';

export default function App(): React.JSX.Element {
  // 1_234_567n micro-USDC -> "1.234567": core's bigint money path, live on Hermes.
  const coreProof = formatUnits(1_234_567n, 6);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Local Books</Text>
      <Text style={styles.tagline}>
        Private income books for people paid in crypto.
      </Text>
      <Text style={styles.detail}>Watch-only. No backend. No telemetry.</Text>
      <Text style={styles.core}>core wired: {coreProof} USDC</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  tagline: {
    fontSize: 16,
    textAlign: 'center',
  },
  detail: {
    fontSize: 14,
    opacity: 0.7,
  },
  core: {
    marginTop: 16,
    fontSize: 13,
    fontFamily: 'monospace',
    opacity: 0.7,
  },
});
