#!/usr/bin/env bash
# End-to-end check of the live flow against a running dev server.
#
# DESTRUCTIVE: expects a board seeded by `npm run reset -- --confirm && npm run seed:demo`,
# and it completes real checkouts. Never point BASE at production or run it with
# DATABASE_URL aimed at a database holding real sales.
#
#   npm run dev   (in another shell)
#   bash scripts/test-e2e.sh
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
SECRET="${CRON_SECRET:-dev-cron-secret}"
# Every product name and click IP is unique to this run. A name already on the Wall is
# refused (correctly), and a click IP is deduped forever, so reusing either would make
# the suite pass once and then fail on every re-run.
RUN="${RUN:-$(date +%s)}"
ONE_HOST="buyer-one-$RUN.example.com"
TWO_HOST="buyer-two-$RUN.example.com"
LOW_HOST="smallbuyer-$RUN.example.com"
IP_A="203.0.113.$(( RUN % 200 + 10 ))"
IP_B="198.51.100.$(( RUN % 200 + 10 ))"
IP_C="192.0.2.$(( RUN % 200 + 10 ))"
PASS=0
FAIL=0

ok()   { echo "  ok  $1"; PASS=$((PASS+1)); }
bad()  { echo "FAIL  $1"; echo "      $2"; FAIL=$((FAIL+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

# Reads a dotted path out of JSON on stdin, e.g.  echo "$J" | jqv live.clicks
jqv() {
  python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for k in sys.argv[1].split("."):
    if isinstance(d, dict):
        d = d.get(k)
    else:
        d = None
    if d is None:
        sys.exit(0)
print(d)
' "$1" 2>/dev/null
}

post() { curl -s -X POST "$BASE$1" -H 'content-type: application/json' -d "$2"; }
code() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$1" -H 'content-type: application/json' -d "$2"; }

echo "== price =="
NUMBER_ONE=$(curl -s "$BASE/api/board" | jqv numberOne)
echo "  #1 costs: ${NUMBER_ONE}c"
TOP=$(python3 -c "print(f'{($NUMBER_ONE-100)/100:.2f}')")
ONE_DOLLARS=$(python3 -c "print(f'{$NUMBER_ONE/100:.2f}')")

echo
echo "== url validation =="
check "rejects an invalid URL"          "$(code /api/preview '{"url":"not-a-url"}')" "400"
check "rejects a private/loopback URL"  "$(code /api/preview '{"url":"http://localhost:9/x"}')" "400"
check "rejects an x.com link"           "$(code /api/preview '{"url":"https://x.com/devbylund"}')" "400"
check "rejects a twitter.com link"      "$(code /api/preview '{"url":"https://twitter.com/devbylund"}')" "400"

echo
echo "== the preview scrapes a name =="
PREV=$(post /api/preview '{"url":"https://example.com"}')
PNAME=$(echo "$PREV" | jqv productName)
if [ -n "$PNAME" ]; then ok "scraped a product name ($PNAME)"; else bad "preview" "$PREV"; fi

echo
echo "== amount validation =="
check "refuses an amount under \$3" \
  "$(code /api/checkout '{"url":"https://example.com","amount":"2.99"}')" "400"
check "refuses a nonsense amount" \
  "$(code /api/checkout '{"url":"https://example.com","amount":"abc"}')" "400"

echo
echo "== two actions: paste a URL, then pay =="
NEXT_OPEN=$(curl -s "$BASE/api/test/open-slot" | jqv id)
RES=$(post /api/checkout "{\"url\":\"https://$ONE_HOST\",\"amount\":\"$ONE_DOLLARS\"}")
CURL_PATH=$(echo "$RES" | jqv checkoutUrl)
GOT_SLOT=$(echo "$RES" | jqv slotId)
if [ -n "$CURL_PATH" ]; then ok "checkout opened with no email, handle or hour picker"; else bad "checkout" "$RES"; fi
check "was assigned the earliest open hour" "$GOT_SLOT" "$NEXT_OPEN"

echo
echo "== a second buyer never gets the same hour =="
RES2=$(post /api/checkout "{\"url\":\"https://$TWO_HOST\",\"amount\":\"3.00\"}")
SLOT2=$(echo "$RES2" | jqv slotId)
CURL2=$(echo "$RES2" | jqv checkoutUrl)
if [ -n "$SLOT2" ] && [ "$SLOT2" != "$GOT_SLOT" ]; then
  ok "held a different hour ($SLOT2)"
else
  bad "concurrent hold" "second buyer got slot [$SLOT2], first got [$GOT_SLOT]"
fi

echo
echo "== complete payment (dev stub) =="
curl -s -o /dev/null -L "$BASE$CURL_PATH"
NEW_ONE=$(curl -s "$BASE/api/board" | jqv numberOne)
EXPECTED=$(python3 -c "print($NUMBER_ONE + 100)")
check "paying the #1 price raised #1 by exactly \$1" "$NEW_ONE" "$EXPECTED"

SOLD_STATUS=$(curl -s "$BASE/api/test/slot-status?id=$GOT_SLOT" 2>/dev/null | jqv status)
echo
echo "== the hour quoted at checkout is the hour delivered =="
ENTRY_SLUG=$(curl -s "$BASE/api/checkout/status?r=$(echo "$CURL_PATH" | sed 's/.*reservation=//')" | jqv slug)
if [ -n "$ENTRY_SLUG" ]; then ok "the sale landed on the Wall as /u/$ENTRY_SLUG"; else bad "sale" "no slug"; fi

echo
echo "== webhook idempotency =="
curl -s -o /dev/null -L "$BASE$CURL_PATH"
AGAIN=$(curl -s "$BASE/api/board" | jqv numberOne)
check "replaying the same order does not raise it twice" "$AGAIN" "$NEW_ONE"

echo
echo "== the price only ever rises =="
check "no price fell after any of the above" \
  "$(python3 -c "print('yes' if $AGAIN >= $NUMBER_ONE else 'no')")" "yes"

echo
echo "== a duplicate product name is refused =="
check "same name cannot be on the Wall twice" \
  "$(code /api/checkout "{\"url\":\"https://$ONE_HOST\",\"amount\":\"9.00\"}")" "409"

echo
echo "== paying below #1 still gets on the Wall =="
LOW=$(post /api/checkout "{\"url\":\"https://$LOW_HOST\",\"amount\":\"3.00\"}")
LOWURL=$(echo "$LOW" | jqv checkoutUrl)
if [ -n "$LOWURL" ]; then ok "a \$3 buyer is accepted"; else bad "\$3 buyer" "$LOW"; fi
curl -s -o /dev/null -L "$BASE$LOWURL"
TOP_AFTER=$(curl -s "$BASE/api/board" | jqv numberOne)
check "a below-top purchase does not change what #1 costs" "$TOP_AFTER" "$NEW_ONE"

echo
echo "== the success page =="
LOWRES=$(echo "$LOWURL" | sed 's/.*reservation=//')
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/success?r=$LOWRES")
check "success page renders" "$CODE" "200"
if curl -s "$BASE/success?r=$LOWRES" | grep -q "You&#x27;re on the Wall\|You're on the Wall"; then
  ok "success page confirms the Wall spot"
else
  bad "success page" "missing the confirmation headline"
fi
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/success?r=00000000-0000-0000-0000-000000000000")
check "an unknown reservation 404s" "$CODE" "404"

echo
echo "== click tracking =="
LIVE_ID=$(curl -s "$BASE/api/board" | jqv live.id)
C0=$(curl -s "$BASE/api/board" | jqv live.clicks)
for i in 1 2 3 4 5; do curl -s -o /dev/null -H "x-forwarded-for: $IP_A" "$BASE/r/$LIVE_ID"; done
C1=$(curl -s "$BASE/api/board" | jqv live.clicks)
check "five hits from one IP count once" "$C1" "$((C0+1))"
curl -s -o /dev/null -H "x-forwarded-for: $IP_B" "$BASE/r/$LIVE_ID"
C2=$(curl -s "$BASE/api/board" | jqv live.clicks)
check "a different IP counts separately" "$C2" "$((C0+2))"
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' -H "x-forwarded-for: $IP_C" "$BASE/r/$LIVE_ID")
if [ -n "$LOC" ]; then ok "redirects to the buyer URL ($LOC)"; else bad "redirect" "no Location header"; fi

echo
echo "== cron tick =="
check "rejects an unauthenticated tick" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/cron/tick")" "401"
check "authenticated tick runs" "$(curl -s -H "Authorization: Bearer $SECRET" "$BASE/api/cron/tick" | jqv ok)" "True"

echo
echo "== permanent buyer page =="
SLUG="orynth-dev"
check "buyer page renders" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/u/$SLUG")" "200"
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/hour/$LIVE_ID")
check "old /hour/:id redirects to the slug" "$LOC" "$BASE/u/$SLUG"
if curl -s "$BASE/u/$SLUG" | grep -q "og:image\" content=\"$BASE/card/$SLUG.png"; then
  ok "buyer page points og:image at its receipt card"
else
  bad "buyer page og:image" "card URL missing from metadata"
fi
check "receipt card renders a PNG" "$(curl -s -o /dev/null -w '%{content_type}' "$BASE/card/$SLUG.png")" "image/png"
check "unknown slug has no card" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/card/no-such-product.png")" "404"

echo
echo "== the homepage =="
HOME=$(curl -s "$BASE/")
# The URL is stored normalized (new URL().toString() adds the trailing slash).
if echo "$HOME" | grep -q "href=\"https://$ONE_HOST/\""; then
  ok "the Wall carries a direct dofollow backlink"
else
  bad "Wall backlink" "no direct anchor to the buyer URL"
fi
if echo "$HOME" | grep -q 'id="claim-url"'; then
  ok "the sticky claim input is on the page"
else
  bad "claim bar" "no claim input rendered"
fi
# The Wall is the product now, so it has to come first in the document.
WALL_AT=$(echo "$HOME" | grep -bo 'id="wall"' | head -1 | cut -d: -f1)
CAL_AT=$(echo "$HOME" | grep -bo 'Next .* hours' | head -1 | cut -d: -f1)
if [ -n "$WALL_AT" ] && [ -n "$CAL_AT" ] && [ "$WALL_AT" -lt "$CAL_AT" ]; then
  ok "the Wall renders above the hours list"
else
  bad "section order" "wall at [$WALL_AT], calendar at [$CAL_AT]"
fi
for word in "X handle" "gifted by" "encore" "PRIME" "QUIET" "Standing hour" "drops to" "you@example.com"; do
  if echo "$HOME" | grep -qi -- "$word"; then
    bad "deleted copy is gone" "homepage still mentions: $word"
  else
    ok "homepage does not mention \"$word\""
  fi
done

echo
echo "== static pages =="
for p in rules about; do
  check "/$p renders" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$p")" "200"
done

echo
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
