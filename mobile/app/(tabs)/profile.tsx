import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Switch, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAuth } from '../../src/AuthContext';
import { api, formatApiError, getBiometricEnabled, setBiometricEnabled } from '../../src/api';
import { Colors } from '../../src/theme';
import ConfirmDialog from '../../src/components/ConfirmDialog';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const userId = user?._id || user?.id || '';
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);

  const loadData = useCallback(async () => {
    if (!userId) return;
    try {
      const { data } = await api.get(`/patients/${userId}`);
      setProfile(data);
      setError('');
    } catch (e: any) { setError(formatApiError(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    (async () => {
      const hw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setBioSupported(hw && enrolled);
      if (hw && enrolled) {
        const enabled = await getBiometricEnabled();
        setBioEnabled(enabled);
      }
    })();
  }, []);

  const toggleBiometric = async (val: boolean) => {
    setBioEnabled(val);
    await setBiometricEnabled(val);
  };

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Are you sure you want to sign out?')) {
        confirmLogout();
      }
    } else {
      setShowLogoutDialog(true);
    }
  };

  const confirmLogout = async () => {
    setShowLogoutDialog(false);
    await logout();
    router.replace('/login');
  };

  const pp = profile?.profile || {};
  const isPremium = !!pp.premium;

  if (loading) return <SafeAreaView style={s.safe}><View style={s.center} testID="profile-loading"><ActivityIndicator size="large" color={Colors.primary} /></View></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={Colors.primary} />}>
        <Text style={s.pageTitle}>Profile</Text>

        {error ? <View style={s.errBox}><Text style={s.errTxt}>{error}</Text></View> : null}

        {/* Avatar + name */}
        <View style={s.infoCard} testID="profile-info-card">
          <View style={s.avatar}>
            <Text style={s.avatarTxt}>{(pp.full_name || user?.full_name || 'P').split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}</Text>
          </View>
          <Text style={s.name} testID="profile-name">{pp.full_name || user?.full_name || 'Patient'}</Text>
          <Text style={s.email} testID="profile-email">{pp.email || user?.email || ''}</Text>

          {/* Premium badge */}
          <View style={[s.tierBadge, isPremium ? s.tierPremium : s.tierFree]} testID="profile-premium-badge">
            <Ionicons name={isPremium ? 'star' : 'star-outline'} size={12} color={isPremium ? '#059669' : Colors.textTertiary} />
            <Text style={[s.tierTxt, isPremium ? s.tierTxtPremium : s.tierTxtFree]}>{isPremium ? 'Premium' : 'Free'}</Text>
          </View>
        </View>

        {/* Details card */}
        <View style={s.detailsCard} testID="profile-details">
          <View style={s.detailRow}>
            <Text style={s.detailLbl}>Role</Text>
            <Text style={s.detailVal}>Patient</Text>
          </View>
          <View style={s.detailRow}>
            <Text style={s.detailLbl}>Assigned Doctor</Text>
            <Text style={s.detailVal}>{pp.assigned_doctor_id ? `Dr. ${pp.assigned_doctor_id.slice(0, 8)}…` : 'Not assigned'}</Text>
          </View>
        </View>

        {/* Upgrade CTA (free users) */}
        {!isPremium && (
          <TouchableOpacity testID="upgrade-btn" style={s.upgradeBtn} onPress={() => router.push('/upgrade')} activeOpacity={0.8}>
            <Ionicons name="star" size={16} color="#D97706" />
            <Text style={s.upgradeTxt}>Upgrade to Premium</Text>
            <Ionicons name="chevron-forward" size={16} color="#D97706" />
          </TouchableOpacity>
        )}

        {/* Biometric toggle (only if hardware supports it) */}
        {bioSupported && (
          <View style={s.bioRow} testID="biometric-toggle">
            <View style={s.bioLeft}>
              <Ionicons name="finger-print" size={20} color={Colors.primary} />
              <Text style={s.bioLbl}>Biometric Login</Text>
            </View>
            <Switch value={bioEnabled} onValueChange={toggleBiometric} trackColor={{ false: Colors.border, true: Colors.normal }} thumbColor={Colors.white} />
          </View>
        )}

        {/* Logout */}
        <TouchableOpacity testID="logout-btn" style={s.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={18} color={Colors.critical} />
          <Text style={s.logoutTxt}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={s.version}>PulseHub Patient App v1.0.0</Text>
      </ScrollView>

      <ConfirmDialog
        visible={showLogoutDialog}
        title="Sign Out"
        message="Are you sure you want to sign out?"
        confirmText="Sign Out"
        cancelText="Cancel"
        destructive
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutDialog(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  pageTitle: { fontSize: 24, fontWeight: '700', color: Colors.text, letterSpacing: -0.5, marginBottom: 20 },
  errBox: { backgroundColor: Colors.criticalBg, borderWidth: 1, borderColor: Colors.criticalBorder, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16 },
  errTxt: { color: Colors.critical, fontSize: 13 },
  infoCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 16 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarTxt: { color: Colors.white, fontSize: 22, fontWeight: '700' },
  name: { fontSize: 20, fontWeight: '700', color: Colors.text },
  email: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  tierBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  tierPremium: { backgroundColor: Colors.normalBg, borderColor: Colors.normalBorder },
  tierFree: { backgroundColor: Colors.borderLight, borderColor: Colors.border },
  tierTxt: { fontSize: 12, fontWeight: '600' },
  tierTxtPremium: { color: Colors.normal },
  tierTxtFree: { color: Colors.textTertiary },
  detailsCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 16, marginBottom: 16 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  detailLbl: { fontSize: 14, color: Colors.textSecondary },
  detailVal: { fontSize: 14, fontWeight: '600', color: Colors.text },
  upgradeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.warningBg, borderWidth: 1, borderColor: Colors.warningBorder, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16, minHeight: 48 },
  upgradeTxt: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.warning },
  bioRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 16, minHeight: 48 },
  bioLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bioLbl: { fontSize: 14, fontWeight: '500', color: Colors.text },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: Colors.criticalBorder, borderRadius: 12, paddingVertical: 14, backgroundColor: Colors.criticalBg, marginBottom: 16, minHeight: 48 },
  logoutTxt: { fontSize: 15, fontWeight: '600', color: Colors.critical },
  version: { fontSize: 12, color: Colors.textTertiary, textAlign: 'center' },
});
