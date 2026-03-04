#!/bin/bash
# Scenario 3: Conflict Detection
# Run from project root: bash scripts/scenario3.sh

set -e
CMD="npx tsx src/index.ts"

echo "════════════════════════════════════════"
echo "SCENARIO 3 — Conflict Detection"
echo "════════════════════════════════════════"

echo ""
echo "── THREAD 1: Email to Alex (candidate) ──"
OUTPUT1=$($CMD --channel email --to alex@example.com "Ask Alex for his availability for an interview next week")
echo "$OUTPUT1"
THREAD1=$(echo "$OUTPUT1" | grep "Thread ID" | awk '{print $3}')
echo "→ Thread ID: $THREAD1"

echo ""
echo "── Alex replies ──"
$CMD --thread "$THREAD1" --from alex@example.com "I can only do Friday - I'm giving notice at my current job Mon-Thu"

echo ""
echo "── THREAD 2: SMS to Jordan (hiring manager) ──"
OUTPUT2=$($CMD --channel sms --to jordan@example.com "Ask Jordan when they can interview Alex next week")
echo "$OUTPUT2"
THREAD2=$(echo "$OUTPUT2" | grep "Thread ID" | awk '{print $3}')
echo "→ Thread ID: $THREAD2"

echo ""
echo "── Jordan replies ──"
$CMD --thread "$THREAD2" --from jordan@example.com "I'm at a conference Friday. Any other day works."

echo ""
echo "── THREAD 3: Update Lisa (recruiter) — agent must detect conflict ──"
$CMD --channel email --to lisa@example.com "Update Lisa on scheduling Alex's interview with Jordan"

echo ""
echo "✓ Scenario 3 complete"
