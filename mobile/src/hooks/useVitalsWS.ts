import { useEffect, useRef, useState } from 'react';
import { getToken, WS_BASE } from '../api';

export type WSStatus = 'connecting' | 'live' | 'reconnecting' | 'idle';

export interface VitalEvent {
  type: string;
  patient_id: string;
  metric: string;
  value: number;
  unit: string;
  severity: string;
  recorded_at: string;
  device?: string;
}

interface UseVitalsWSOptions {
  patientId?: string;
  onEvent?: (event: VitalEvent) => void;
  enabled?: boolean;
}

export function useVitalsWS({ patientId, onEvent, enabled = true }: UseVitalsWSOptions) {
  const [status, setStatus] = useState<WSStatus>('idle');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectMsRef = useRef(1000);
  const closedByUserRef = useRef(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return;
    }

    closedByUserRef.current = false;
    let timer: ReturnType<typeof setTimeout>;

    const connect = async () => {
      const token = await getToken();
      if (!token) {
        setStatus('idle');
        return;
      }

      let url = `${WS_BASE}/ws/vitals?token=${encodeURIComponent(token)}`;
      if (patientId) url += `&patient_id=${encodeURIComponent(patientId)}`;

      setStatus(reconnectMsRef.current === 1000 ? 'connecting' : 'reconnecting');
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('live');
        reconnectMsRef.current = 1000;
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'vital' && onEventRef.current) {
            onEventRef.current(msg);
          }
        } catch {}
      };

      ws.onerror = () => {};

      ws.onclose = () => {
        if (closedByUserRef.current) {
          setStatus('idle');
          return;
        }
        setStatus('reconnecting');
        timer = setTimeout(connect, reconnectMsRef.current);
        reconnectMsRef.current = Math.min(reconnectMsRef.current * 2, 30000);
      };
    };

    connect();

    return () => {
      closedByUserRef.current = true;
      if (timer) clearTimeout(timer);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, [patientId, enabled]);

  return { status };
}
