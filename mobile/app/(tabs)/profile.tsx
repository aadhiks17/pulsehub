import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/AuthContext';
import { api, formatApiError } from '../../src/api';
import { Colors } from '../../src/theme';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const userId = user?._id || user?.id || '';
  const [profile, setProfile] = useState<any>(null);
  const [prescriptions, setPrescriptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    if (!userId) return;
    try {
      const [profileRes, rxRes] = await Promise.all([
        api.get(`/patients/${userId}`),
        api.get(`/prescriptions/${userId}`),
      ]);
      setProfile(profileRes.data);
      setPrescriptions(rxRes.data);
      setError('');
    } catch (e: any) {
      setError(formatApiError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/login');
        },
      },
    ]);
  };

  const patientProfile = profile?.profile || {};

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center} testID="profile-loading">
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        <Text style={styles.pageTitle}>Profile</Text>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Patient Info Card */}
        <View style={styles.infoCard} testID="profile-info-card">
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {(patientProfile.full_name || user?.full_name || 'P')
                .split(' ')
                .map((n: string) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2)}
            </Text>
          </View>
          <Text style={styles.profileName} testID="profile-name">
            {patientProfile.full_name || user?.full_name || 'Patient'}
          </Text>
          <Text style={styles.profileEmail} testID="profile-email">
            {patientProfile.email || user?.email || ''}
          </Text>
          {patientProfile.premium && (
            <View style={styles.premiumBadge} testID="profile-premium-badge">
              <Ionicons name="star" size={12} color="#D97706" />
              <Text style={styles.premiumText}>Premium</Text>
            </View>
          )}
        </View>

        {/* Prescriptions Section */}
        <View style={styles.rxSection} testID="prescription-panel">
          <View style={styles.rxHeader}>
            <Ionicons name="medical" size={18} color={Colors.primary} />
            <Text style={styles.rxTitle}>Prescriptions</Text>
            <Text style={styles.rxCount}>{prescriptions.length}</Text>
          </View>

          {prescriptions.length === 0 ? (
            <View style={styles.rxEmpty}>
              <Text style={styles.rxEmptyText}>No prescriptions yet.</Text>
            </View>
          ) : (
            prescriptions.map((rx) => (
              <View
                key={rx._id}
                style={styles.rxItem}
                testID={`rx-item-${rx._id}`}
              >
                <View style={styles.rxItemHeader}>
                  <View style={styles.rxDrugRow}>
                    <Text style={styles.rxDrug}>{rx.drug}</Text>
                    <Text style={styles.rxDosage}>{rx.dosage}</Text>
                  </View>
                  <Text style={styles.rxDate}>
                    {rx.issued_at
                      ? new Date(rx.issued_at).toLocaleDateString()
                      : '—'}
                  </Text>
                </View>
                <Text style={styles.rxFreq}>
                  {rx.frequency}
                  {rx.notes ? ` · ${rx.notes}` : ''}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* Logout */}
        <TouchableOpacity
          testID="logout-btn"
          style={styles.logoutBtn}
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <Ionicons name="log-out-outline" size={18} color={Colors.critical} />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>PulseHub Patient App v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  pageTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.5,
    marginBottom: 20,
  },
  errorBox: {
    backgroundColor: Colors.criticalBg,
    borderWidth: 1,
    borderColor: Colors.criticalBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  errorText: { color: Colors.critical, fontSize: 13 },
  infoCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { color: Colors.white, fontSize: 22, fontWeight: '700' },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  profileEmail: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    backgroundColor: Colors.warningBg,
    borderWidth: 1,
    borderColor: Colors.warningBorder,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  premiumText: { fontSize: 12, fontWeight: '600', color: Colors.warning },
  rxSection: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  rxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  rxTitle: { fontSize: 16, fontWeight: '600', color: Colors.text, flex: 1 },
  rxCount: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    backgroundColor: Colors.borderLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  rxEmpty: { paddingVertical: 16, alignItems: 'center' },
  rxEmptyText: { fontSize: 14, color: Colors.textTertiary },
  rxItem: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    backgroundColor: Colors.background,
  },
  rxItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  rxDrugRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rxDrug: { fontSize: 14, fontWeight: '600', color: Colors.text },
  rxDosage: { fontSize: 13, color: Colors.textSecondary },
  rxDate: { fontSize: 12, color: Colors.textTertiary },
  rxFreq: { fontSize: 12, color: Colors.textSecondary },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.criticalBorder,
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: Colors.criticalBg,
    marginBottom: 16,
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: Colors.critical },
  versionText: {
    fontSize: 12,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
});
