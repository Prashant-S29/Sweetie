#!/bin/bash
# Scenario 2: Multi-Channel Parallel Outreach
# Run from project root: bash scripts/scenario2.sh

set -e
CMD="npx tsx src/index.ts"

echo "════════════════════════════════════════"
echo "SCENARIO 2 — Multi-Channel Parallel Outreach"
echo "════════════════════════════════════════"

echo ""
echo "── THREAD 1: SMS to Bob ──"
OUTPUT1=$($CMD --channel sms --to bob@example.com "Ask Bob if he's free Friday for a meeting")
echo "$OUTPUT1"
THREAD1=$(echo "$OUTPUT1" | grep "Thread ID" | awk '{print $3}')
echo "→ Thread ID: $THREAD1"

echo ""
echo "── THREAD 2: Email to Carol ──"
OUTPUT2=$($CMD --channel email --to carol@example.com "Ask Carol if she's available Friday for a meeting with Bob")
echo "$OUTPUT2"
THREAD2=$(echo "$OUTPUT2" | grep "Thread ID" | awk '{print $3}')
echo "→ Thread ID: $THREAD2"

echo ""
echo "── Bob replies via SMS ──"
$CMD --thread "$THREAD1" --from bob@example.com "Friday afternoon works, after 2pm"

echo ""
echo "── Carol replies via Email ──"
$CMD --thread "$THREAD2" --from carol@example.com "Yes, I'm free all day Friday"

echo ""
echo "── Synthesize both responses ──"
$CMD --channel email --to manager@example.com "What's the status on the Bob and Carol Friday meeting?"

echo ""
echo "✓ Scenario 2 complete"
