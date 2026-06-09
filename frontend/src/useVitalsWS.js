import { useEffect, useRef, useState } from "react";
import { getToken, WS_BASE } from "./api";

/**
 * useVitalsWS — connect to /api/ws/vitals?token=...[&patient_id=...]
 * Auto-reconnect with exponential backoff capped at 30s.
 *
 * onEvent: function called with each {type:"vital", ...} payload.
 * Returns { status: "connecting"|"live"|"reconnecting"|"idle" }.
 */
export function useVitalsWS({ patientId, onEvent }) {
  const [status, setStatus] = useState("connecting");
  const wsRef = useRef(null);
  const reconnectMsRef = useRef(1000);
  const closedByUserRef = useRef(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    closedByUserRef.current = false;
    let timer;

    const connect = () => {
      const token = getToken();
      if (!token) { setStatus("idle"); return; }
      let url = `${WS_BASE}/ws/vitals?token=${encodeURIComponent(token)}`;
      if (patientId) url += `&patient_id=${encodeURIComponent(patientId)}`;

      setStatus(reconnectMsRef.current === 1000 ? "connecting" : "reconnecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("live");
        reconnectMsRef.current = 1000;
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "vital" && onEventRef.current) onEventRef.current(msg);
        } catch (_) {}
      };
      ws.onerror = () => { /* allow onclose to drive reconnect */ };
      ws.onclose = () => {
        if (closedByUserRef.current) { setStatus("idle"); return; }
        setStatus("reconnecting");
        timer = setTimeout(connect, reconnectMsRef.current);
        reconnectMsRef.current = Math.min(reconnectMsRef.current * 2, 30000);
      };
    };

    connect();

    return () => {
      closedByUserRef.current = true;
      if (timer) clearTimeout(timer);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.close();
    };
  }, [patientId]);

  return { status };
}
