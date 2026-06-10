import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useAuth } from '../src/AuthContext';
import { api, formatApiError } from '../src/api';
import { Colors } from '../src/theme';

interface Tier { id: string; name: string; price_usd: number; features: string[]; }
interface BillingInfo { premium: boolean; since?: string; status?: string; stripe_subscription_id?: string; tier?: string; mode?: string; }

export default function UpgradeScreen() {
  const { user, refreshUser } = useAuth();
  const router = useRouter();

  const [tiers, setTiers] = useState<Tier[]>([]);
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [tiersRes, billingRes] = await Promise.all([
        api.get('/billing/tiers'),
        api.get('/billing/me'),
      ]);
      setTiers(tiersRes.data);
      setBilling(billingRes.data);
      setError('');
    } catch (e: any) { setError(formatApiError(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const showToast = (text: string, type: 'success' | 'error' | 'info') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4000);
  };

  const processSuccessfulCheckout = async () => {
    try {
      const { data } = await api.get('/billing/me');
      setBilling(data);
      if (data.premium) {
        showToast('Welcome to Premium!', 'success');
        await refreshUser();
      } else {
        showToast('Payment was not completed', 'info');
      }
    } catch {}
  };

  const handleUpgrade = async () => {
    setActionLoading(true);
    setError('');
    try {
      const redirectBase = Linking.createURL('upgrade');
      const sep = redirectBase.includes('?') ? '&' : '?';
      const successUrl = `${redirectBase}${sep}checkout=success`;
      const cancelUrl = `${redirectBase}${sep}checkout=cancel`;

      const { data } = await api.post('/billing/checkout', {
        tier: 'premium',
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      let checkoutUrl: string = data.checkout_url;
      const backendBase = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      if (backendBase) {
        try {
          const parsed = new URL(checkoutUrl);
          checkoutUrl = backendBase + parsed.pathname + parsed.search;
        } catch {}
      }

      const result = await WebBrowser.openAuthSessionAsync(checkoutUrl, redirectBase);

      if (result.type === 'success' && result.url) {
        if (result.url.includes('checkout=success')) {
          await processSuccessfulCheckout();
        } else {
          showToast('Payment was not completed', 'info');
        }
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        showToast('Checkout was dismissed', 'info');
      }
    } catch (e: any) {
      setError(formatApiError(e));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = () => {
    Alert.alert(
      'Cancel Premium',
      "Cancel your Premium subscription? You'll lose access to real-time doctor chat and continuous device streaming.",
      [
        { text: 'Keep Premium', style: 'cancel' },
        {
          text: 'Cancel Subscription',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              await api.post('/billing/cancel');
              const { data } = await api.get('/billing/me');
              setBilling(data);
              await refreshUser();
              showToast('Subscription canceled', 'info');
            } catch (e: any) {
              setError(formatApiError(e));
            } finally {
              setActionLoading(false);
            }
          },
        },
      ],
    );
  };

  const isPremium = billing?.premium === true;
  const mode = billing?.mode || 'mock';
  const freeTier = tiers.find((t) => t.id === 'free');
  const premiumTier = tiers.find((t) => t.id === 'premium');

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center} testID="upgrade-loading">
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={s.loadTxt}>Loading plans…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      {/* Toast overlay */}
      {toast && (
        <View style={[s.toast, toast.type === 'success' ? s.toastSuccess : toast.type === 'error' ? s.toastError : s.toastInfo]} testID="billing-toast">
          <Ionicons
            name={toast.type === 'success' ? 'checkmark-circle' : toast.type === 'error' ? 'close-circle' : 'information-circle'}
            size={18}
            color={toast.type === 'success' ? '#059669' : toast.type === 'error' ? '#E11D48' : '#0284C7'}
          />
          <Text style={[s.toastTxt, toast.type === 'success' ? s.toastTxtSuccess : toast.type === 'error' ? s.toastTxtError : s.toastTxtInfo]}>{toast.text}</Text>
        </View>
      )}

      {/* Action loading overlay */}
      {actionLoading && (
        <View style={s.overlay} testID="billing-action-loading">
          <View style={s.overlayCard}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={s.overlayTxt}>Processing…</Text>
          </View>
        </View>
      )}

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={Colors.primary} />}
      >
        {/* Back button */}
        <TouchableOpacity testID="upgrade-back-btn" style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color={Colors.text} />
          <Text style={s.backTxt}>Back</Text>
        </TouchableOpacity>

        {/* Title */}
        <Text style={s.title} testID="upgrade-title">Choose Your Plan</Text>

        {/* Mode badge */}
        <View style={s.modeBadge} testID="billing-mode-badge">
          <Ionicons name={mode === 'mock' ? 'flask' : 'card'} size={13} color={mode === 'mock' ? '#92400E' : '#0284C7'} />
          <Text style={[s.modeTxt, mode === 'mock' ? s.modeMock : s.modeLive]}>
            {mode === 'mock' ? 'MOCK MODE' : 'LIVE MODE'}
          </Text>
          <Text style={s.modeSub}>{mode === 'mock' ? '(test environment)' : '(Stripe test cards)'}</Text>
        </View>

        {error ? <View style={s.errBox}><Text style={s.errTxt}>{error}</Text></View> : null}

        {/* Tier cards */}
        <View style={s.tiersRow}>
          {/* Free tier card */}
          {freeTier && (
            <View style={[s.tierCard, !isPremium && s.tierCardActive]} testID="tier-card-free">
              {!isPremium && <View style={s.currentBadge}><Text style={s.currentBadgeTxt}>Current Plan</Text></View>}
              <Text style={s.tierName}>{freeTier.name}</Text>
              <View style={s.priceRow}>
                <Text style={s.priceAmt}>$0</Text>
                <Text style={s.priceUnit}>/mo</Text>
              </View>
              <View style={s.featuresList}>
                {freeTier.features.map((f, i) => (
                  <View key={i} style={s.featureRow}>
                    <Ionicons name="checkmark" size={16} color={Colors.textTertiary} />
                    <Text style={s.featureTxt}>{f}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Premium tier card */}
          {premiumTier && (
            <View style={[s.tierCard, s.tierCardPremium, isPremium && s.tierCardActive]} testID="tier-card-premium">
              {isPremium && <View style={[s.currentBadge, s.currentBadgePremium]}><Text style={[s.currentBadgeTxt, s.currentBadgeTxtPremium]}>Current Plan</Text></View>}
              <View style={s.premiumLabelRow}>
                <Ionicons name="star" size={14} color="#D97706" />
                <Text style={s.tierNamePremium}>{premiumTier.name}</Text>
              </View>
              <View style={s.priceRow}>
                <Text style={s.priceAmt}>${premiumTier.price_usd.toFixed(2)}</Text>
                <Text style={s.priceUnit}>/mo</Text>
              </View>
              <View style={s.featuresList}>
                {premiumTier.features.map((f, i) => (
                  <View key={i} style={s.featureRow}>
                    <Ionicons name="checkmark-circle" size={16} color={Colors.normal} />
                    <Text style={s.featureTxt}>{f}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* Action area */}
        {!isPremium ? (
          <TouchableOpacity testID="checkout-upgrade-btn" style={s.upgradeBtn} onPress={handleUpgrade} disabled={actionLoading} activeOpacity={0.8}>
            <Ionicons name="star" size={18} color={Colors.white} />
            <Text style={s.upgradeBtnTxt}>Upgrade to Premium — $9.99/mo</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.manageSection} testID="subscription-manage">
            <View style={s.subInfoCard}>
              <View style={s.subInfoRow}>
                <Ionicons name="checkmark-circle" size={18} color={Colors.normal} />
                <Text style={s.subStatusTxt}>Subscription is active</Text>
              </View>
              {billing?.since && (
                <Text style={s.subSinceTxt}>
                  Premium since {new Date(billing.since).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                </Text>
              )}
            </View>
            <TouchableOpacity testID="cancel-subscription-btn" style={s.cancelBtn} onPress={handleCancel} disabled={actionLoading} activeOpacity={0.7}>
              <Ionicons name="close-circle-outline" size={18} color={Colors.critical} />
              <Text style={s.cancelBtnTxt}>Cancel Premium</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadTxt: { marginTop: 12, fontSize: 14, color: Colors.textSecondary },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, alignSelf: 'flex-start', minHeight: 44 },
  backTxt: { fontSize: 15, color: Colors.text, fontWeight: '500' },
  title: { fontSize: 24, fontWeight: '700', color: Colors.text, letterSpacing: -0.5, marginTop: 8, marginBottom: 12 },
  modeBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16, alignSelf: 'flex-start' },
  modeTxt: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  modeMock: { color: '#92400E' },
  modeLive: { color: '#0284C7' },
  modeSub: { fontSize: 11, color: '#A16207' },
  errBox: { backgroundColor: Colors.criticalBg, borderWidth: 1, borderColor: Colors.criticalBorder, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16 },
  errTxt: { color: Colors.critical, fontSize: 13 },

  tiersRow: { gap: 12, marginBottom: 20 },
  tierCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 20, position: 'relative' as const },
  tierCardPremium: { borderColor: '#FDE68A' },
  tierCardActive: { borderWidth: 2, borderColor: Colors.primary },
  currentBadge: { position: 'absolute' as const, top: -10, right: 16, backgroundColor: Colors.primary, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  currentBadgePremium: { backgroundColor: '#D97706' },
  currentBadgeTxt: { color: Colors.white, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' as const },
  currentBadgeTxtPremium: { color: Colors.white },
  tierName: { fontSize: 18, fontWeight: '600', color: Colors.text, marginBottom: 4 },
  premiumLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  tierNamePremium: { fontSize: 18, fontWeight: '600', color: '#92400E' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2, marginBottom: 14 },
  priceAmt: { fontSize: 32, fontWeight: '700', color: Colors.text },
  priceUnit: { fontSize: 14, color: Colors.textTertiary },
  featuresList: { gap: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureTxt: { fontSize: 14, color: Colors.textSecondary, flex: 1 },

  upgradeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#D97706', borderRadius: 12, paddingVertical: 16, minHeight: 52 },
  upgradeBtnTxt: { color: Colors.white, fontSize: 16, fontWeight: '600' },

  manageSection: { gap: 12 },
  subInfoCard: { backgroundColor: Colors.normalBg, borderWidth: 1, borderColor: Colors.normalBorder, borderRadius: 12, padding: 16 },
  subInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subStatusTxt: { fontSize: 15, fontWeight: '600', color: Colors.normal },
  subSinceTxt: { fontSize: 13, color: '#047857', marginTop: 6, marginLeft: 26 },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: Colors.criticalBorder, borderRadius: 12, paddingVertical: 14, backgroundColor: Colors.criticalBg, minHeight: 48 },
  cancelBtnTxt: { fontSize: 15, fontWeight: '600', color: Colors.critical },

  toast: { position: 'absolute' as const, top: 60, left: 20, right: 20, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1, zIndex: 100, elevation: 10 },
  toastSuccess: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  toastError: { backgroundColor: '#FFF1F2', borderColor: '#FECDD3' },
  toastInfo: { backgroundColor: '#F0F9FF', borderColor: '#BAE6FD' },
  toastTxt: { fontSize: 14, fontWeight: '500', flex: 1 },
  toastTxtSuccess: { color: '#059669' },
  toastTxtError: { color: '#E11D48' },
  toastTxtInfo: { color: '#0284C7' },

  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center', zIndex: 200, elevation: 20 },
  overlayCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 32, alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20, shadowOffset: { width: 0, height: 4 } },
  overlayTxt: { fontSize: 15, color: Colors.textSecondary, fontWeight: '500' },
});
