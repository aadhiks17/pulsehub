import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAuth } from '../src/AuthContext';
import { formatApiError, clearSession, getBiometricAsked, setBiometricEnabled } from '../src/api';
import { Colors } from '../src/theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const promptBiometric = async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const alreadyAsked = await getBiometricAsked();

      if (hasHardware && isEnrolled && !alreadyAsked) {
        return new Promise<void>((resolve) => {
          Alert.alert(
            'Biometric Login',
            'Enable biometric unlock for faster sign-in?',
            [
              {
                text: 'Not Now',
                style: 'cancel',
                onPress: async () => {
                  await setBiometricEnabled(false);
                  resolve();
                },
              },
              {
                text: 'Enable',
                onPress: async () => {
                  await setBiometricEnabled(true);
                  resolve();
                },
              },
            ],
          );
        });
      }
    } catch {}
  };

  const submit = async () => {
    if (!email.trim() || !password) return;
    setError('');
    setPending(true);
    try {
      const u = await login(email.trim(), password);
      if (u.role !== 'patient') {
        await clearSession();
        setError('This app is for patients only. Doctors and admins should use the web portal.');
        return;
      }
      await promptBiometric();
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(formatApiError(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoRow}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoLetter}>P</Text>
            </View>
            <Text style={styles.logoText}>
              PulseHub{' '}
              <Text style={styles.logoSub}>· Patient</Text>
            </Text>
          </View>

          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>
            Access your vitals, prescriptions, and chat with your doctor.
          </Text>

          <View testID="login-form">
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                testID="login-email"
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="patient@pulsehub.test"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
              />
            </View>

            <View style={[styles.field, { marginTop: 16 }]}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                testID="login-password"
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={Colors.textTertiary}
                secureTextEntry
                autoComplete="password"
              />
            </View>

            {error ? (
              <View style={styles.errorBox} testID="login-error">
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              testID="login-submit"
              style={[styles.button, pending && styles.buttonDisabled]}
              onPress={submit}
              disabled={pending}
              activeOpacity={0.8}
            >
              {pending ? (
                <ActivityIndicator color={Colors.white} size="small" />
              ) : (
                <Text style={styles.buttonText}>Sign in</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.testInfo}>
            <Text style={styles.testInfoText}>
              Free: patient1@pulsehub.test / Patient123!
            </Text>
            <Text style={styles.testInfoText}>
              Premium: patient4@pulsehub.test / Patient123!
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 40 },
  logoBadge: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  logoLetter: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  logoText: { fontSize: 16, fontWeight: '600', color: Colors.text, letterSpacing: -0.3 },
  logoSub: { color: Colors.textTertiary, fontWeight: '400' },
  title: { fontSize: 28, fontWeight: '700', color: Colors.text, letterSpacing: -0.5, marginBottom: 6 },
  subtitle: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: 32 },
  field: { marginBottom: 0 },
  label: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500', marginBottom: 4 },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: Colors.text,
  },
  errorBox: {
    backgroundColor: Colors.criticalBg, borderWidth: 1, borderColor: Colors.criticalBorder,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginTop: 16,
  },
  errorText: { color: Colors.critical, fontSize: 13 },
  button: {
    backgroundColor: Colors.primary, borderRadius: 8, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', minHeight: 48, marginTop: 20,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: Colors.white, fontSize: 15, fontWeight: '600' },
  testInfo: { marginTop: 40, alignItems: 'center', gap: 2 },
  testInfoText: { fontSize: 12, color: Colors.textTertiary },
});
