import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Polyline, Line, Circle } from 'react-native-svg';
import { useAuth } from '../../src/AuthContext';
import { api, formatApiError } from '../../src/api';
import { useVitalsWS } from '../../src/hooks/useVitalsWS';
import {
  Colors,
  METRICS,
  METRIC_LABEL,
  METRIC_UNIT,
  METRIC_CONFIG,
  severityColors,
  fmtTime,
} from '../../src/theme';

const SEV_COLOR: Record<string, string> = {
  critical: '#E11D48',
  warning: '#D97706',
  normal: '#059669',
};

function VitalsChart({
  data,
  domain,
  bands,
}: {
  data: Array<{ value: number; severity?: string; recorded_at: string }>;
  domain: [number, number];
  bands: number[];
}) {
  const screenWidth = Dimensions.get('window').width;
  const width = screenWidth - 72;
  const height = 140;
  const pad = { top: 10, bottom: 10, left: 4, right: 4 };
  const cW = width - pad.left - pad.right;
  const cH = height - pad.top - pad.bottom;
  const [min, max] = domain;

  if (data.length === 0) {
    return (
      <View style={{ height, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: Colors.textTertiary, fontSize: 13 }}>No data available</Text>
      </View>
    );
  }

  const yScale = (v: number) => pad.top + cH - ((v - min) / (max - min)) * cH;
  const xScale = (i: number) =>
    pad.left + (data.length > 1 ? (i / (data.length - 1)) * cW : cW / 2);

  const points = data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(' ');
  const lastIdx = data.length - 1;
  const lastPoint = data[lastIdx];
  const lastSev = lastPoint.severity || 'normal';

  return (
    <Svg width={width} height={height}>
      {bands.map((b, i) => (
        <Line
          key={i}
          x1={0}
          y1={yScale(b)}
          x2={width}
          y2={yScale(b)}
          stroke="#CBD5E1"
          strokeDasharray="4 4"
          strokeWidth={1}
        />
      ))}
      <Polyline points={points} fill="none" stroke="#0F172A" strokeWidth={1.5} />
      <Circle
        cx={xScale(lastIdx)}
        cy={yScale(lastPoint.value)}
        r={4}
        fill={SEV_COLOR[lastSev] || '#059669'}
      />
    </Svg>
  );
}

function MetricChartCard({
  metricKey,
  points,
}: {
  metricKey: string;
  points: Array<{ value: number; severity?: string; recorded_at: string }>;
}) {
  const config = METRIC_CONFIG[metricKey];
  const last = points.length > 0 ? points[points.length - 1] : null;
  const sev = severityColors(last?.severity || 'normal');

  return (
    <View style={styles.chartCard} testID={`chart-${metricKey}`}>
      <View style={styles.chartHeader}>
        <View>
          <Text style={styles.chartLabel}>{METRIC_LABEL[metricKey]}</Text>
          <View style={styles.chartValueRow}>
            <Text style={styles.chartValue}>
              {last ? Math.round(last.value) : '—'}
            </Text>
            <Text style={styles.chartUnit}>{METRIC_UNIT[metricKey]}</Text>
          </View>
        </View>
        {last?.severity && (
          <View style={[styles.sevBadge, { backgroundColor: sev.bg, borderColor: sev.border }]}>
            <View style={[styles.sevDot, { backgroundColor: sev.text }]} />
            <Text style={[styles.sevText, { color: sev.text }]}>{last.severity}</Text>
          </View>
        )}
      </View>
      <VitalsChart data={points} domain={config.domain} bands={config.bands} />
    </View>
  );
}

export default function VitalsScreen() {
  const { user } = useAuth();
  const userId = user?._id || user?.id || '';
  const [series, setSeries] = useState<Record<string, any[]>>({
    glucose: [],
    hr: [],
    spo2: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Submit vitals state
  const [selectedMetric, setSelectedMetric] = useState<string>('glucose');
  const [submitValue, setSubmitValue] = useState('');
  const [submitPending, setSubmitPending] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');
  const [submitError, setSubmitError] = useState('');

  const loadVitals = useCallback(async () => {
    if (!userId) return;
    const from = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const to = new Date().toISOString();
    try {
      const results = await Promise.all(
        METRICS.map((m) =>
          api.get(
            `/vitals/${userId}?metric=${m}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=2000`,
          ),
        ),
      );
      setSeries({
        glucose: results[0].data,
        hr: results[1].data,
        spo2: results[2].data,
      });
      setError('');
    } catch (e: any) {
      setError(formatApiError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    loadVitals();
  }, [loadVitals]);

  const { status } = useVitalsWS({
    patientId: userId,
    enabled: !!userId,
    onEvent: (ev) => {
      setSeries((cur) => {
        const k = ev.metric;
        if (!cur[k]) return cur;
        const point = { recorded_at: ev.recorded_at, value: ev.value, severity: ev.severity };
        const last = cur[k].length > 0 ? cur[k][cur[k].length - 1] : null;
        if (last && last.recorded_at === point.recorded_at) return cur;
        return { ...cur, [k]: [...cur[k], point].slice(-500) };
      });
    },
  });

  const onRefresh = () => {
    setRefreshing(true);
    loadVitals();
  };

  const handleSubmitVitals = async () => {
    const val = parseFloat(submitValue);
    if (isNaN(val)) {
      setSubmitError('Please enter a valid number');
      return;
    }
    setSubmitError('');
    setSubmitMsg('');
    setSubmitPending(true);
    try {
      await api.post('/vitals', {
        patient_id: userId,
        metric: selectedMetric,
        value: val,
        unit: METRIC_UNIT[selectedMetric],
      });
      setSubmitMsg(`${METRIC_LABEL[selectedMetric]} reading submitted!`);
      setSubmitValue('');
      setTimeout(() => setSubmitMsg(''), 3000);
    } catch (e: any) {
      setSubmitError(formatApiError(e));
    } finally {
      setSubmitPending(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center} testID="vitals-loading">
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading vitals…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          keyboardShouldPersistTaps="handled"
        >
          <View testID="vitals-page">
            <Text style={styles.pageTitle}>Vitals</Text>
            <Text style={styles.pageSub}>7-day trends for your key metrics</Text>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {METRICS.map((m) => (
              <MetricChartCard key={m} metricKey={m} points={series[m]} />
            ))}

            {/* Self-submit vitals */}
            <View style={styles.submitSection} testID="submit-vitals-section">
              <Text style={styles.submitTitle}>Record a Reading</Text>
              <Text style={styles.submitSub}>Submit your own vitals measurement</Text>

              <View style={styles.metricPicker}>
                {METRICS.map((m) => (
                  <TouchableOpacity
                    key={m}
                    testID={`submit-metric-${m}`}
                    style={[
                      styles.metricBtn,
                      selectedMetric === m && styles.metricBtnActive,
                    ]}
                    onPress={() => setSelectedMetric(m)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.metricBtnText,
                        selectedMetric === m && styles.metricBtnTextActive,
                      ]}
                    >
                      {METRIC_LABEL[m]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.submitRow}>
                <TextInput
                  testID="submit-value-input"
                  style={styles.submitInput}
                  value={submitValue}
                  onChangeText={setSubmitValue}
                  placeholder={`Value (${METRIC_UNIT[selectedMetric]})`}
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="numeric"
                />
                <TouchableOpacity
                  testID="submit-vitals-btn"
                  style={[styles.submitBtn, submitPending && styles.submitBtnDisabled]}
                  onPress={handleSubmitVitals}
                  disabled={submitPending}
                  activeOpacity={0.8}
                >
                  {submitPending ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <Text style={styles.submitBtnText}>Submit</Text>
                  )}
                </TouchableOpacity>
              </View>

              {submitError ? (
                <Text style={styles.submitErrorText} testID="submit-error">{submitError}</Text>
              ) : null}
              {submitMsg ? (
                <Text style={styles.submitSuccessText} testID="submit-success">{submitMsg}</Text>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: Colors.textSecondary },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  pageTitle: { fontSize: 24, fontWeight: '700', color: Colors.text, letterSpacing: -0.5 },
  pageSub: { fontSize: 14, color: Colors.textSecondary, marginTop: 2, marginBottom: 20 },
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
  chartCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  chartLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chartValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 2 },
  chartValue: { fontSize: 22, fontWeight: '700', color: Colors.text, fontVariant: ['tabular-nums'] },
  chartUnit: { fontSize: 13, color: Colors.textTertiary },
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
  submitSection: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  submitTitle: { fontSize: 16, fontWeight: '600', color: Colors.text },
  submitSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2, marginBottom: 14 },
  metricPicker: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  metricBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  metricBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  metricBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  metricBtnTextActive: { color: Colors.white },
  submitRow: { flexDirection: 'row', gap: 10 },
  submitInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: Colors.text,
  },
  submitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 11,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 46,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: Colors.white, fontSize: 14, fontWeight: '600' },
  submitErrorText: { color: Colors.critical, fontSize: 12, marginTop: 8 },
  submitSuccessText: { color: Colors.normal, fontSize: 12, marginTop: 8 },
});
