#!/usr/bin/env bash
set -euo pipefail

MODEL_JSON=$(curl -s http://127.0.0.1:8089/api/v1/app/models)
MODEL_ID=$(printf '%s' "$MODEL_JSON" | python3 -c 'import sys,json; o=json.load(sys.stdin); d=o.get("data"); ms=[]
if isinstance(d,list):
    ms=d
elif isinstance(d,dict):
    ms=d.get("models") or d.get("list") or d.get("items") or []
print(next((m.get("model_id") or m.get("modelId") for m in ms if isinstance(m,dict) and (m.get("model_id") or m.get("modelId"))), ""))')

if [[ -z "$MODEL_ID" ]]; then
  echo "no model_id"
  echo "$MODEL_JSON"
  exit 1
fi

SESSION_ID="e2e_$(date +%s)_$RANDOM"
TS=$(python3 -c 'import time; print(int(time.time()*1000))')
SSE_LOG="/tmp/aig_sse_${SESSION_ID}.log"
POST_LOG="/tmp/aig_post_${SESSION_ID}.log"
SSEPID=""
POSTPID=""

cleanup(){
  [[ -n "$SSEPID" ]] && kill "$SSEPID" >/dev/null 2>&1 || true
  [[ -n "$POSTPID" ]] && kill "$POSTPID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

BODY=$(python3 - <<PY
import json
print(json.dumps({
  "id":"msg_$SESSION_ID",
  "sessionId":"$SESSION_ID",
  "taskType":"Garak-Scan",
  "timestamp":$TS,
  "content":"快速扫描",
  "params":{"model_id":"$MODEL_ID","intensity":"fast"},
  "attachments":[],
  "countryIsoCode":"zh"
}, ensure_ascii=False))
PY
)

curl -s -X POST http://127.0.0.1:8089/api/v1/app/tasks -H 'Content-Type: application/json' -d "$BODY" > "$POST_LOG" 2>&1 &
POSTPID=$!
sleep 1
curl -N -s "http://127.0.0.1:8089/api/v1/app/tasks/sse/${SESSION_ID}" > "$SSE_LOG" 2>&1 &
SSEPID=$!
wait "$POSTPID"
RESP=$(cat "$POST_LOG")
echo "create=$RESP"

FINAL=""
for i in $(seq 1 90); do
  DETAIL=$(curl -s "http://127.0.0.1:8089/api/v1/app/tasks/${SESSION_ID}")
  STATUS=$(printf '%s' "$DETAIL" | python3 -c 'import sys,json; o=json.load(sys.stdin); d=o.get("data") or {}; print(d.get("status", "") if o.get("status")==0 else "")')
  if [[ "$STATUS" == "done" || "$STATUS" == "error" || "$STATUS" == "terminated" ]]; then
    FINAL="$STATUS"
    echo "session=$SESSION_ID status=$FINAL"
    printf '%s' "$DETAIL" > /tmp/aig_detail_${SESSION_ID}.json
    python3 -c 'import json,sys; obj=json.load(open(sys.argv[1])); d=obj.get("data") or {}; msgs=d.get("messages") or []; text="\n".join(json.dumps(m,ensure_ascii=False) for m in msgs); print("contains_garak_not_installed=", "Garak 未安装" in text); print("contains_exit_status_2=", "exit status 2" in text); print("message_count=", len(msgs));
if "Garak 未安装" in text or "exit status 2" in text: raise SystemExit(2)' "/tmp/aig_detail_${SESSION_ID}.json"
    exit 0
  fi
  sleep 2
done

echo "timeout_waiting_final_status session=$SESSION_ID"
exit 2
