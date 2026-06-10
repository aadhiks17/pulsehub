import { useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAuth } from '../src/AuthContext';
import { Colors } from '../src/theme';

export default function Index() {
  const { user, bootstrapping, biometricPending, completeBiometric } = useAuth();
  const router = useRouter();
  const biometricTriedRef = useRef(false);

  useEffect(() => {
    if (bootstrapping) return;

    if (biometricPending && !biometricTriedRef.current) {
      biometricTriedRef.current = true;
      (async () => {
        try {
          const result = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Unlock PulseHub',
            fallbackLabel: 'Use password',
          });
          await completeBiometric(result.success);
        } catch {
          await completeBiometric(false);
        }
      })();
      return;
    }

    if (biometricPending) return;

    if (user && user.role === 'patient') {
      router.replace('/(tabs)');
    } else {
      router.replace('/login');
    }
  }, [user, bootstrapping, biometricPending]);

  return (
    <View style={styles.container} testID="splash-screen">
      <View style={styles.logoBadge}>
        <Text style={styles.logoLetter}>P</Text>
      </View>
      <ActivityIndicator size="large" color={Colors.primary} style={styles.spinner} />
      {biometricPending && (
        <Text style={styles.bioText}>Verifying identity…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoBadge: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  logoLetter: { color: Colors.white, fontSize: 24, fontWeight: '700' },
  spinner: { marginBottom: 12 },
  bioText: { fontSize: 14, color: Colors.textSecondary },
});
