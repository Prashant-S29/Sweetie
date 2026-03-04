#!/bin/bash
# Scenario 1: Cross-Thread Availability Aggregation
# Run from project root: bash scripts/scenario1.sh

set -e
CMD="npx tsx src/index.ts"

echo "════════════════════════════════════════"
echo "SCENARIO 1 — Cross-Thread Aggregation"
echo "════════════════════════════════════════"

echo ""
echo "── THREAD 1: Email to Bob ──"
OUTPUT=$($CMD --channel email --to bob@example.com "Ask Bob for his availability next week")
echo "$OUTPUT"
THREAD1=$(echo "$OUTPUT" | grep "Thread ID" | awk '{print $3}')
echo "→ Thread ID: $THREAD1"

echo ""
echo "── Bob replies ──"
$CMD --thread "$THREAD1" --from bob@example.com "I'm free Monday 2-4pm and Wednesday all day"

echo ""
echo "── THREAD 2: SMS to Sarah ──"
OUTPUT2=$($CMD --channel sms --to sarah@example.com "Ask Sarah when she can meet with Bob")
echo "$OUTPUT2"
THREAD2=$(echo "$OUTPUT2" | grep "Thread ID" | awk '{print $3}')
echo "→ Thread ID: $THREAD2"

echo ""
echo "── Sarah replies ──"
$CMD --thread "$THREAD2" --from sarah@example.com "Tuesday or Wednesday afternoon works for me"

echo ""
echo "── THREAD 3: Schedule (must retrieve from threads 1 & 2) ──"
$CMD --channel email --to manager@example.com "Schedule Bob and Sarah's meeting"

echo ""
echo "✓ Scenario 1 complete"
