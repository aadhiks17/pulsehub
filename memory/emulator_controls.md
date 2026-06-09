# PulseHub Vitals Emulator — Control Surface

The emulator runs as a supervised Node.js process and streams realistic vitals
for every seeded patient to `POST /api/vitals`. It exposes a small HTTP control
surface for triggering anomalies on demand.

## Process & logs
- Supervisor program: `vitals-emulator`
- Logs: `/var/log/supervisor/vitals-emulator.{out,err}.log`
- Default cadence: CGM every 5s, PulseOx (HR + SpO2) every 10s.
- Service account: `emulator@pulsehub.system` (role: `system`). Password is in
  `/app/backend/.env` (`EMULATOR_PASSWORD`) and mirrored to
  `/app/memory/test_credentials.md` after first boot.

## Control endpoints (all on `http://localhost:9001`)

### `GET /status`
Returns the emulator's running state — patient count, cadence, the last
reading sent per patient, and the pending anomaly queue.

```bash
curl -s http://localhost:9001/status | jq
```

### `POST /trigger/:patientId/:kind`
Queues a single anomaly that will be emitted on the **next** scheduled reading
for that metric.

| kind          | metric  | value | resulting severity |
|---------------|---------|-------|--------------------|
| `hypo`        | glucose | 38    | critical           |
| `hyper`       | glucose | 320   | critical           |
| `hypoxia`     | spo2    | 84    | critical           |
| `bradycardia` | hr      | 32    | critical           |
| `tachycardia` | hr      | 145   | critical           |

Examples:
```bash
# crash a patient's glucose
curl -X POST http://localhost:9001/trigger/<patient_id>/hypo

# crash their SpO2
curl -X POST http://localhost:9001/trigger/<patient_id>/hypoxia
```

Each triggered anomaly is consumed once. To create a sustained event, fire the
trigger every cadence interval.

## End-to-end demo flow

1. Pick any patient: `curl -s -H "Authorization: Bearer $DOC_JWT" http://localhost:8001/api/patients | jq '.[0].id'`
2. Subscribe to the WS firehose: `wss://<INTERNAL_HOST>/api/ws/vitals?token=<doctor_jwt>`
3. Trigger: `curl -X POST http://localhost:9001/trigger/<patient_id>/hypo`
4. Within ~5 seconds you will receive a `{type:"vital", metric:"glucose", value:38, severity:"critical", ...}` event on the WS firehose.
