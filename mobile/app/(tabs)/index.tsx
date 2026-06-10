import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, SectionList, ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Polyline, Line, Circle } from 'react-native-svg';
import { useAuth } from '../../src/AuthContext';
import { api, formatApiError } from '../../src/api';
import { useVitalsWS } from '../../src/hooks/useVitalsWS';
import {
  Colors, METRICS, METRIC_LABEL, METRIC_UNIT, METRIC_CONFIG,
  severityColors, computeRisk, fmtTime, SEVERITY_ORDER,
} from '../../src/theme';

const SEV_CLR: Record<string, string> = { critical: '#E11D48', warning: '#D97706', normal: '#059669' };

function VitalsChart({ data, domain, bands }: { data: any[]; domain: [number, number]; bands: number[] }) {
  const w = Dimensions.get('window').width - 72;
  const h = 120;
  const [min, max] = domain;
  if (!data.length) return <View style={{ height: h, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: Colors.textTertiary, fontSize: 12 }}>No data</Text></View>;
  const cH = h - 20;
  const yS = (v: number) => 10 + cH - ((v - min) / (max - min)) * cH;
  const xS = (i: number) => 4 + (data.length > 1 ? (i / (data.length - 1)) * (w - 8) : (w - 8) / 2);
  const pts = data.map((d: any, i: number) => `${xS(i)},${yS(d.value)}`).join(' ');
  const last = data[data.length - 1];
  return (
    <Svg width={w} height={h}>
      {bands.map((b, i) => <Line key={i} x1={0} y1={yS(b)} x2={w} y2={yS(b)} stroke="#CBD5E1" strokeDasharray="4 4" strokeWidth={1} />)}
      <Polyline points={pts} fill="none" stroke="#0F172A" strokeWidth={1.5} />
      <Circle cx={xS(data.length - 1)} cy={yS(last.value)} r={4} fill={SEV_CLR[last.severity] || '#059669'} />
    </Svg>
  );
}

interface FeedItem { id: string; metric: string; value: number; unit: string; severity: string; recorded_at: string; }

function groupByDay(items: FeedItem[]): { title: string; data: FeedItem[] }[] {
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const groups: Record<string, FeedItem[]> = {};
  const order: string[] = [];
  for (const item of items) {
    const d = new Date(item.recorded_at);
    let label: string;
    if (d.toDateString() === now.toDateString()) label = 'Today';
    else if (d.toDateString() === yesterday.toDateString()) label = 'Yesterday';
    else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (!groups[label]) { groups[label] = []; order.push(label); }
    groups[label].push(item);
  }
  return order.map((t) => ({ title: t, data: groups[t] }));
}

export default function HomeScreen() {
  const { user } = useAuth();
  const userId = user?._id || user?.id || '';
  const [profile, setProfile] = useState<any>(null);
  const [series, setSeries] = useState<Record<string, any[]>>({ glucose: [], hr: [], spo2: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadAll = useCallback(async () => {
    if (!userId) return;
    const from = new Date(Date.now() - 7 * 86400000).toISOString();
    const to = new Date().toISOString();
    try {
      const [profR, ...vitR] = await Promise.all([
        api.get(`/patients/${userId}`),
        ...METRICS.map((m) => api.get(`/vitals/${userId}?metric=${m}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=2000`)),
      ]);
      setProfile(profR.data);
      setSeries({ glucose: vitR[0].data, hr: vitR[1].data, spo2: vitR[2].data });
      setError('');
    } catch (e: any) { setError(formatApiError(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [userId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const { status } = useVitalsWS({
    patientId: userId, enabled: !!userId,
    onEvent: (ev) => {
      setProfile((p: any) => {
        if (!p) return p;
        const nl = { ...(p.latest || {}), [ev.metric]: { value: ev.value, unit: ev.unit, severity: ev.severity, recorded_at: ev.recorded_at } };
        return { ...p, latest: nl, risk_level: computeRisk(nl) };
      });
      setSeries((c) => {
        const k = ev.metric; if (!c[k]) return c;
        const pt = { recorded_at: ev.recorded_at, value: ev.value, severity: ev.severity };
        return { ...c, [k]: [...c[k], pt].slice(-500) };
      });
    },
  });

  const feedSections = useMemo(() => {
    const all: FeedItem[] = [];
    for (const m of METRICS) {
      const pts = series[m] || [];
      const recent = pts.slice(-15);
      recent.forEach((p: any, i: number) => all.push({ id: `${m}-${i}-${p.recorded_at}`, metric: m, value: p.value, unit: METRIC_UNIT[m], severity: p.severity || 'normal', recorded_at: p.recorded_at }));
    }
    all.sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
    return groupByDay(all);
  }, [series]);

  const latest = profile?.latest || {};
  const riskLevel = profile?.risk_level || 'normal';
  const riskSev = severityColors(riskLevel);
  const patientName = profile?.profile?.full_name || user?.full_name || 'Patient';
  const wsMap: Record<string, { label: string; color: string }> = {
    live: { label: 'Live', color: Colors.normal },
    connecting: { label: 'Connecting…', color: Colors.warning },
    reconnecting: { label: 'Reconnecting…', color: Colors.warning },
    idle: { label: 'Offline', color: Colors.textTertiary },
  };
  const ws = wsMap[status] || wsMap.idle;

  if (loading) return <SafeAreaView style={s.safe}><View style={s.center} testID="dashboard-loading"><ActivityIndicator size="large" color={Colors.primary} /><Text style={s.loadTxt}>Loading…</Text></View></SafeAreaView>;

  const header = () => (
    <View>
      {/* Header */}
      <View style={s.headerRow} testID="dashboard-header">
        <View style={s.headerLeft}>
          <Text style={s.greeting}>Hello, {patientName.split(' ')[0]}</Text>
          <Text style={s.headerSub}>Your health overview</Text>
        </View>
        <View style={[s.wsPill, { backgroundColor: ws.color === Colors.normal ? Colors.normalBg : ws.color === Colors.warning ? Colors.warningBg : Colors.borderLight }]} testID="connection-pill">
          <View style={[s.wsDot, { backgroundColor: ws.color }]} />
          <Text style={[s.wsLbl, { color: ws.color }]}>{ws.label}</Text>
        </View>
      </View>

      {error ? <View style={s.errBox} testID="dashboard-error"><Text style={s.errTxt}>{error}</Text></View> : null}

      {/* Risk */}
      <View style={[s.riskCard, { backgroundColor: riskSev.bg, borderColor: riskSev.border }]} testID="risk-level-card">
        <Text style={[s.riskLbl, { color: riskSev.text }]}>Overall Risk Level</Text>
        <View style={s.riskRow}><View style={[s.riskDot, { backgroundColor: riskSev.text }]} /><Text style={[s.riskVal, { color: riskSev.text }]}>{riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1)}</Text></View>
      </View>

      {/* Metric tiles */}
      {METRICS.map((m) => {
        const d = latest[m]; const sv = severityColors(d?.severity || 'normal');
        return (
          <View key={m} style={s.tile} testID={`metric-card-${m}`}>
            <View style={s.tileHdr}><Text style={s.tileName}>{METRIC_LABEL[m]}</Text>{d?.severity && <View style={[s.sevBadge, { backgroundColor: sv.bg, borderColor: sv.border }]}><View style={[s.sevDot, { backgroundColor: sv.text }]} /><Text style={[s.sevTxt, { color: sv.text }]}>{d.severity}</Text></View>}</View>
            <View style={s.tileBody}><Text style={s.tileVal}>{d ? Math.round(d.value) : '—'}</Text><Text style={s.tileUnit}>{METRIC_UNIT[m]}</Text></View>
            <Text style={s.tileTime}>{d?.recorded_at ? fmtTime(d.recorded_at) : 'No data'}</Text>
          </View>
        );
      })}

      {/* Charts */}
      <Text style={s.secTitle}>7-Day Trends</Text>
      {METRICS.map((m) => {
        const cfg = METRIC_CONFIG[m]; const pts = series[m] || []; const last = pts.length ? pts[pts.length - 1] : null; const sv = severityColors(last?.severity || 'normal');
        return (
          <View key={m} style={s.chartCard} testID={`chart-${m}`}>
            <View style={s.chartHdr}>
              <View><Text style={s.chartLbl}>{METRIC_LABEL[m]}</Text><View style={s.chartValRow}><Text style={s.chartVal}>{last ? Math.round(last.value) : '—'}</Text><Text style={s.chartUnit}>{METRIC_UNIT[m]}</Text></View></View>
              {last?.severity && <View style={[s.sevBadge, { backgroundColor: sv.bg, borderColor: sv.border }]}><View style={[s.sevDot, { backgroundColor: sv.text }]} /><Text style={[s.sevTxt, { color: sv.text }]}>{last.severity}</Text></View>}
            </View>
            <VitalsChart data={pts} domain={cfg.domain} bands={cfg.bands} />
          </View>
        );
      })}

      <Text style={s.secTitle}>Recent History</Text>
    </View>
  );

  const renderItem = ({ item }: { item: FeedItem }) => {
    const sv = severityColors(item.severity);
    return (
      <View style={s.feedItem} testID={`feed-item-${item.id}`}>
        <View style={[s.feedDot, { backgroundColor: sv.text }]} />
        <View style={s.feedContent}>
          <Text style={s.feedMetric}>{METRIC_LABEL[item.metric]}</Text>
          <View style={s.feedValRow}><Text style={s.feedVal}>{Math.round(item.value)}</Text><Text style={s.feedUnit}>{item.unit}</Text></View>
        </View>
        <Text style={s.feedTime}>{new Date(item.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
      </View>
    );
  };

  const renderSectionHeader = ({ section }: any) => (
    <View style={s.sectionHdr}><Text style={s.sectionHdrTxt}>{section.title}</Text></View>
  );

  return (
    <SafeAreaView style={s.safe}>
      <SectionList
        sections={feedSections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        ListHeaderComponent={header}
        stickySectionHeadersEnabled
        contentContainerStyle={s.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll(); }} tintColor={Colors.primary} />}
        ListEmptyComponent={<View style={s.emptyFeed}><Text style={s.emptyFeedTxt}>No recent readings</Text></View>}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadTxt: { marginTop: 12, fontSize: 14, color: Colors.textSecondary },
  listContent: { padding: 20, paddingBottom: 32 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  headerLeft: { flex: 1 },
  greeting: { fontSize: 24, fontWeight: '700', color: Colors.text, letterSpacing: -0.5 },
  headerSub: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  wsPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  wsDot: { width: 6, height: 6, borderRadius: 3 },
  wsLbl: { fontSize: 12, fontWeight: '600' },
  errBox: { backgroundColor: Colors.criticalBg, borderWidth: 1, borderColor: Colors.criticalBorder, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16 },
  errTxt: { color: Colors.critical, fontSize: 13 },
  riskCard: { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 16 },
  riskLbl: { fontSize: 13, fontWeight: '500', marginBottom: 6 },
  riskRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  riskDot: { width: 10, height: 10, borderRadius: 5 },
  riskVal: { fontSize: 20, fontWeight: '700' },
  tile: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 16, marginBottom: 12 },
  tileHdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  tileName: { fontSize: 13, fontWeight: '500', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  sevBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1 },
  sevDot: { width: 5, height: 5, borderRadius: 3 },
  sevTxt: { fontSize: 11, fontWeight: '600' },
  tileBody: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  tileVal: { fontSize: 32, fontWeight: '700', color: Colors.text, fontVariant: ['tabular-nums'] },
  tileUnit: { fontSize: 14, color: Colors.textTertiary },
  tileTime: { fontSize: 12, color: Colors.textTertiary, marginTop: 4 },
  secTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginTop: 16, marginBottom: 12 },
  chartCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 16, marginBottom: 12 },
  chartHdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  chartLbl: { fontSize: 12, fontWeight: '500', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  chartValRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 2 },
  chartVal: { fontSize: 22, fontWeight: '700', color: Colors.text, fontVariant: ['tabular-nums'] },
  chartUnit: { fontSize: 13, color: Colors.textTertiary },
  sectionHdr: { backgroundColor: Colors.background, paddingVertical: 8 },
  sectionHdrTxt: { fontSize: 14, fontWeight: '700', color: Colors.text },
  feedItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  feedDot: { width: 8, height: 8, borderRadius: 4 },
  feedContent: { flex: 1 },
  feedMetric: { fontSize: 13, fontWeight: '600', color: Colors.text },
  feedValRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  feedVal: { fontSize: 15, fontWeight: '700', color: Colors.text, fontVariant: ['tabular-nums'] },
  feedUnit: { fontSize: 11, color: Colors.textTertiary },
  feedTime: { fontSize: 12, color: Colors.textTertiary },
  emptyFeed: { paddingVertical: 24, alignItems: 'center' },
  emptyFeedTxt: { fontSize: 13, color: Colors.textTertiary },
});
