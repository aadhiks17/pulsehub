export const Colors = {
  primary: '#0F172A',
  primaryLight: '#1E293B',
  background: '#F8FAFC',
  surface: '#FFFFFF',
  text: '#0F172A',
  textSecondary: '#64748B',
  textTertiary: '#94A3B8',
  border: '#E2E8F0',
  borderLight: '#F1F5F9',

  critical: '#E11D48',
  criticalBg: '#FFF1F2',
  criticalBorder: '#FECDD3',
  warning: '#D97706',
  warningBg: '#FFFBEB',
  warningBorder: '#FDE68A',
  normal: '#059669',
  normalBg: '#ECFDF5',
  normalBorder: '#A7F3D0',

  live: '#059669',
  liveBg: '#ECFDF5',

  white: '#FFFFFF',
  black: '#000000',
};

export const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  normal: 2,
};

export function severityColors(severity: string) {
  switch (severity) {
    case 'critical':
      return { text: Colors.critical, bg: Colors.criticalBg, border: Colors.criticalBorder };
    case 'warning':
      return { text: Colors.warning, bg: Colors.warningBg, border: Colors.warningBorder };
    case 'normal':
      return { text: Colors.normal, bg: Colors.normalBg, border: Colors.normalBorder };
    default:
      return { text: Colors.textSecondary, bg: Colors.borderLight, border: Colors.border };
  }
}

export const METRICS = ['glucose', 'hr', 'spo2'] as const;

export const METRIC_LABEL: Record<string, string> = {
  glucose: 'Glucose',
  hr: 'Heart Rate',
  spo2: 'SpO₂',
};

export const METRIC_UNIT: Record<string, string> = {
  glucose: 'mg/dL',
  hr: 'bpm',
  spo2: '%',
};

export const METRIC_CONFIG: Record<string, { bands: number[]; domain: [number, number] }> = {
  glucose: { bands: [70, 180], domain: [40, 300] },
  hr: { bands: [50, 120], domain: [30, 160] },
  spo2: { bands: [90], domain: [80, 100] },
};

export function computeRisk(latest: Record<string, any>): string {
  let worst = 'normal';
  for (const m of METRICS) {
    const s = latest?.[m]?.severity;
    if (s && SEVERITY_ORDER[s] < SEVERITY_ORDER[worst]) worst = s;
  }
  return worst;
}

export function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
