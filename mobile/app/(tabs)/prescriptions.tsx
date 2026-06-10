import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/AuthContext';
import { api, formatApiError } from '../../src/api';
import { Colors } from '../../src/theme';

export default function PrescriptionsScreen() {
  const { user } = useAuth();
  const userId = user?._id || user?.id || '';
  const [prescriptions, setPrescriptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadRx = useCallback(async () => {
    if (!userId) return;
    try {
      const { data } = await api.get(`/prescriptions/${userId}`);
      setPrescriptions(data);
      setError('');
    } catch (e: any) { setError(formatApiError(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [userId]);

  useEffect(() => { loadRx(); }, [loadRx]);

  if (loading) return <SafeAreaView style={s.safe}><View style={s.center} testID="rx-loading"><ActivityIndicator size="large" color={Colors.primary} /></View></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadRx(); }} tintColor={Colors.primary} />}>
        <View style={s.hdrRow}>
          <Ionicons name="medical" size={20} color={Colors.primary} />
          <Text style={s.title}>Prescriptions</Text>
          <View style={s.countBadge}><Text style={s.countTxt}>{prescriptions.length}</Text></View>
        </View>

        {error ? <View style={s.errBox}><Text style={s.errTxt}>{error}</Text></View> : null}

        {prescriptions.length === 0 ? (
          <View style={s.empty} testID="rx-empty">
            <Ionicons name="document-text-outline" size={40} color={Colors.textTertiary} />
            <Text style={s.emptyTxt}>No prescriptions yet.</Text>
          </View>
        ) : (
          prescriptions.map((rx, idx) => (
            <View key={rx._id || idx} style={s.rxCard} testID={`rx-item-${rx._id || idx}`}>
              <View style={s.rxTop}>
                <View style={s.drugRow}>
                  <Text style={s.drug}>{rx.drug}</Text>
                  <Text style={s.dosage}>{rx.dosage}</Text>
                </View>
                <Text style={s.date}>{rx.issued_at ? new Date(rx.issued_at).toLocaleDateString() : '—'}</Text>
              </View>
              <Text style={s.freq}>{rx.frequency}{rx.notes ? ` · ${rx.notes}` : ''}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  hdrRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
  title: { fontSize: 24, fontWeight: '700', color: Colors.text, letterSpacing: -0.5, flex: 1 },
  countBadge: { backgroundColor: Colors.borderLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  countTxt: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  errBox: { backgroundColor: Colors.criticalBg, borderWidth: 1, borderColor: Colors.criticalBorder, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16 },
  errTxt: { color: Colors.critical, fontSize: 13 },
  empty: { paddingVertical: 60, alignItems: 'center' },
  emptyTxt: { fontSize: 15, color: Colors.textTertiary, marginTop: 12 },
  rxCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 16, marginBottom: 10 },
  rxTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  drugRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  drug: { fontSize: 15, fontWeight: '600', color: Colors.text },
  dosage: { fontSize: 14, color: Colors.textSecondary },
  date: { fontSize: 12, color: Colors.textTertiary },
  freq: { fontSize: 13, color: Colors.textSecondary },
});
