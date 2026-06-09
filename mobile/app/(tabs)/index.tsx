import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/AuthContext';
import { api, formatApiError } from '../../src/api';
import { useVitalsWS } from '../../src/hooks/useVitalsWS';
import {
  Colors,
  METRICS,
  METRIC_LABEL,
  METRIC_UNIT,
  SEVERITY_ORDER,
  severityColors,
  computeRisk,
  fmtTime,
} from '../../src/theme';

export default function Dashboard() {
  const { user } = useAuth();
  const userId = user?._id || user?.id || '';
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadProfile = useCallback(async () => {
    if (!userId) return;
    try {
      const { data } = await api.get(`/patients/${userId}`);
      setProfile(data);
      setError('');
    } catch (e: any) {
      setError(formatApiError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const onRefresh = () => {
    setRefreshing(true);
    loadProfile();
  };

  const { status } = useVitalsWS({
    patientId: userId,
    enabled: !!userId,
    onEvent: (ev) => {
      setProfile((prev: any) => {
        if (!prev) return prev;
        const nextLatest = {
          ...(prev.latest || {}),
          [ev.metric]: {
            value: ev.value,
            unit: ev.unit,
            severity: ev.severity,
            recorded_at: ev.recorded_at,
          },
        };
        return {
          ...prev,
          latest: nextLatest,
          risk_level: computeRisk(nextLatest),
        };
      });
    },
  });

  const latest = profile?.latest || {};
  const riskLevel = profile?.risk_level || 'normal';
  const riskSev = severityColors(riskLevel);
  const patientName = profile?.profile?.full_name || user?.full_name || 'Patient';

  const wsLabelMap: Record<string, { label: string; color: string }> = {
    live: { label: 'Live', color: Colors.normal },
    connecting: { label: 'Connecting…', color: Colors.warning },
    reconnecting: { label: 'Reconnecting…', color: Colors.warning },
    idle: { label: 'Offline', color: Colors.textTertiary },
  };
  const wsInfo = wsLabelMap[status] || wsLabelMap.idle;

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center} testID="dashboard-loading">
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading your dashboard…</Text>
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
        {/* Header */}
        <View style={styles.header} testID="dashboard-header">
          <View style={styles.headerLeft}>
            <Text style={styles.greeting}>Hello, {patientName.split(' ')[0]}</Text>
            <Text style={styles.headerSub}>Your health overview</Text>
          </View>
          <View
            style={[styles.wsPill, { backgroundColor: wsInfo.color === Colors.normal ? Colors.normalBg : Colors.borderLight }]}
            testID="connection-pill"
          >
            <View style={[styles.wsDot, { backgroundColor: wsInfo.color }]} />
            <Text style={[styles.wsLabel, { color: wsInfo.color }]}>{wsInfo.label}</Text>
          </View>
        </View>

        {error ? (
          <View style={styles.errorBox} testID="dashboard-error">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Risk Level Card */}
        <View
          style={[styles.riskCard, { backgroundColor: riskSev.bg, borderColor: riskSev.border }]}
          testID="risk-level-card"
        >
          <Text style={[styles.riskLabel, { color: riskSev.text }]}>Overall Risk Level</Text>
          <View style={styles.riskRow}>
            <View style={[styles.riskDot, { backgroundColor: riskSev.text }]} />
            <Text style={[styles.riskValue, { color: riskSev.text }]}>
              {riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1)}
            </Text>
          </View>
        </View>

        {/* Metric Cards */}
        {METRICS.map((m) => {
          const data = latest[m];
          const sev = severityColors(data?.severity || 'normal');
          return (
            <View key={m} style={styles.metricCard} testID={`metric-card-${m}`}>
              <View style={styles.metricHeader}>
                <Text style={styles.metricName}>{METRIC_LABEL[m]}</Text>
                {data?.severity && (
                  <View style={[styles.sevBadge, { backgroundColor: sev.bg, borderColor: sev.border }]}>
                    <View style={[styles.sevDot, { backgroundColor: sev.text }]} />
                    <Text style={[styles.sevText, { color: sev.text }]}>{data.severity}</Text>
                  </View>
                )}
              </View>
              <View style={styles.metricBody}>
                <Text style={styles.metricValue}>
                  {data ? Math.round(data.value) : '—'}
                </Text>
                <Text style={styles.metricUnit}>{METRIC_UNIT[m]}</Text>
              </View>
              <Text style={styles.metricTime}>
                {data?.recorded_at ? fmtTime(data.recorded_at) : 'No data yet'}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: Colors.textSecondary },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 32 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  headerLeft: { flex: 1 },
  greeting: { fontSize: 24, fontWeight: '700', color: Colors.text, letterSpacing: -0.5 },
  headerSub: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  wsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  wsDot: { width: 6, height: 6, borderRadius: 3 },
  wsLabel: { fontSize: 12, fontWeight: '600' },
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
  riskCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  riskLabel: { fontSize: 13, fontWeight: '500', marginBottom: 6 },
  riskRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  riskDot: { width: 10, height: 10, borderRadius: 5 },
  riskValue: { fontSize: 20, fontWeight: '700' },
  metricCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  metricHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  metricName: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sevBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  sevDot: { width: 5, height: 5, borderRadius: 3 },
  sevText: { fontSize: 11, fontWeight: '600' },
  metricBody: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  metricValue: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },
  metricUnit: { fontSize: 14, color: Colors.textTertiary },
  metricTime: { fontSize: 12, color: Colors.textTertiary, marginTop: 4 },
});
