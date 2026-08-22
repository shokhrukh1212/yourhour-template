#!/usr/bin/env bash
# End-to-end check of the live flow against a running dev server.
#
# DESTRUCTIVE: expects a board seeded by `npm run reset && npm run seed:demo`, and it
# completes real checkouts. Never point BASE at production or run it with DATABASE_URL
# aimed at a database holding real sales.
#
#   npm run dev   (in another shell)
#   bash scripts/test-e2e.sh
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
SECRET="${CRON_SECRET:-dev-cron-secret}"
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

echo "== board =="
BOARD=$(curl -s "$BASE/api/board")
PRICE0=$(echo "$BOARD" | jqv price)
echo "  board price: $PRICE0"
FLOOR_DOLLARS=$(python3 -c "print(f'{$PRICE0/100:.2f}')")

echo
echo "== checkout validation =="
R=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/checkout" \
  -H 'content-type: application/json' -d '{"slotId":"1","amount":"5","url":"not-a-url","email":"a@b.co"}')
check "rejects an invalid URL" "$R" "400"

R=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/checkout" \
  -H 'content-type: application/json' -d '{"slotId":"1","amount":"5","url":"http://localhost:9/x","email":"a@b.co"}')
check "rejects a private/loopback URL" "$R" "400"

# The pitch is scraped from the buyer's page, not submitted, so it is capped in
# lib/metadata.ts and by the slots.pitch CHECK rather than by request validation.
R=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/checkout" \
  -H 'content-type: application/json' -d '{"slotId":"1","amount":"5","url":"https://ok.com","email":"a@b.co","xHandle":"not a handle"}')
check "rejects a malformed X handle" "$R" "400"

echo
echo "== the current hour is locked =="
LIVE_ID=$(curl -s "$BASE/api/board" | jqv live.id)
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
  -d "{\"slotId\":\"$LIVE_ID\",\"amount\":\"5\",\"url\":\"https://ok.com\",\"email\":\"a@b.co\"}")
check "refuses to sell the in-progress hour" "$CODE" "409"

echo
echo "== reserve an open hour =="
SLOT=$(curl -s "$BASE/api/test/open-slot" | jqv id)
if [ -z "$SLOT" ]; then bad "find an open slot" "helper endpoint returned nothing"; fi
RES=$(curl -s -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
  -d "{\"slotId\":\"$SLOT\",\"amount\":\"$FLOOR_DOLLARS\",\"url\":\"https://example.com\",\"email\":\"e2e@example.com\"}")
CURL=$(echo "$RES" | jqv checkoutUrl)
if [ -n "$CURL" ]; then ok "reserved slot $SLOT and got a checkout URL"; else bad "reserve slot" "$RES"; fi

echo
echo "== double-booking is refused =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
  -d "{\"slotId\":\"$SLOT\",\"amount\":\"$FLOOR_DOLLARS\",\"url\":\"https://other.com\",\"email\":\"two@example.com\"}")
check "second buyer cannot take the reserved hour" "$CODE" "409"

echo
echo "== complete payment (dev stub) =="
curl -s -o /dev/null -L "$BASE$CURL"
PRICE1=$(curl -s "$BASE/api/board" | jqv price)
EXPECTED=$(python3 -c "print(max(100, round($PRICE0*1.20)))")
check "board price rose 20% after the sale" "$PRICE1" "$EXPECTED"

echo
echo "== webhook idempotency =="
curl -s -o /dev/null -L "$BASE$CURL"
PRICE2=$(curl -s "$BASE/api/board" | jqv price)
check "replaying the same order does not bump P twice" "$PRICE2" "$PRICE1"

echo
echo "== the floor is a minimum, not a price =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
  -d "{\"slotId\":\"$(curl -s "$BASE/api/test/open-slot" | jqv id)\",\"amount\":\"0.01\",\"url\":\"https://example.com\",\"email\":\"low@example.com\"}")
check "refuses an amount below the floor" "$CODE" "409"

PRICE_BEFORE=$(curl -s "$BASE/api/board" | jqv price)
OVER_SLOT=$(curl -s "$BASE/api/test/open-slot" | jqv id)
OVER_DOLLARS=$(python3 -c "print(f'{$PRICE_BEFORE/100*5:.2f}')")
OVER=$(curl -s -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
  -d "{\"slotId\":\"$OVER_SLOT\",\"amount\":\"$OVER_DOLLARS\",\"url\":\"https://bigspender.example.com\",\"email\":\"big@example.com\"}")
curl -s -o /dev/null -L "$BASE$(echo "$OVER" | jqv checkoutUrl)"
PRICE_AFTER=$(curl -s "$BASE/api/board" | jqv price)
EXPECTED=$(python3 -c "print(max(100, round($PRICE_BEFORE*1.20)))")
check "paying 5x the floor still moves it only 20%" "$PRICE_AFTER" "$EXPECTED"

echo
echo "== a Wall spot takes no hour and moves no price =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
  -d '{"kind":"wall","amount":"4.99","url":"https://example.com","email":"cheap@example.com"}')
check "refuses a Wall spot under \$5" "$CODE" "400"

PRICE_BEFORE=$(curl -s "$BASE/api/board" | jqv price)
WALLRES=$(curl -s -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
  -d '{"kind":"wall","amount":"25.00","url":"https://wallbuyer.example.com","email":"wall@example.com"}')
WALLURL=$(echo "$WALLRES" | jqv checkoutUrl)
if [ -n "$WALLURL" ]; then ok "Wall spot checkout opened"; else bad "Wall checkout" "$WALLRES"; fi
curl -s -o /dev/null -L "$BASE$WALLURL"
check "a Wall spot does not move the floor" "$(curl -s "$BASE/api/board" | jqv price)" "$PRICE_BEFORE"

echo
echo "== a multi-hour block is one sale =="
PRICE_BEFORE=$(curl -s "$BASE/api/board" | jqv price)
BLOCK_SLOT=$(curl -s "$BASE/api/test/open-slot" | jqv id)
BLOCK_DOLLARS=$(python3 -c "print(f'{round($PRICE_BEFORE*2.5)/100:.2f}')")
BLOCKRES=$(curl -s -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
  -d "{\"slotId\":\"$BLOCK_SLOT\",\"blockHours\":3,\"amount\":\"$BLOCK_DOLLARS\",\"url\":\"https://blockbuyer.example.com\",\"email\":\"block@example.com\"}")
BLOCKURL=$(echo "$BLOCKRES" | jqv checkoutUrl)
if [ -n "$BLOCKURL" ]; then ok "3-hour block reserved"; else bad "block checkout" "$BLOCKRES"; fi
curl -s -o /dev/null -L "$BASE$BLOCKURL"
EXPECTED=$(python3 -c "print(max(100, round($PRICE_BEFORE*1.20)))")
check "three hours bought together move the floor once" "$(curl -s "$BASE/api/board" | jqv price)" "$EXPECTED"

echo
echo "== click tracking =="
C0=$(curl -s "$BASE/api/board" | jqv live.clicks)
for i in 1 2 3 4 5; do curl -s -o /dev/null -H 'x-forwarded-for: 203.0.113.9' "$BASE/r/$LIVE_ID"; done
C1=$(curl -s "$BASE/api/board" | jqv live.clicks)
check "five hits from one IP count once" "$C1" "$((C0+1))"
curl -s -o /dev/null -H 'x-forwarded-for: 198.51.100.4' "$BASE/r/$LIVE_ID"
C2=$(curl -s "$BASE/api/board" | jqv live.clicks)
check "a different IP counts separately" "$C2" "$((C0+2))"

LOC=$(curl -s -o /dev/null -w '%{redirect_url}' -H 'x-forwarded-for: 203.0.113.77' "$BASE/r/$LIVE_ID")
if [ -n "$LOC" ]; then ok "redirects to the buyer URL ($LOC)"; else bad "redirect" "no Location header"; fi

echo
echo "== cron tick =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/cron/tick")
check "rejects an unauthenticated tick" "$CODE" "401"
TICK=$(curl -s -H "Authorization: Bearer $SECRET" "$BASE/api/cron/tick")
OKV=$(echo "$TICK" | jqv ok)
check "authenticated tick runs" "$OKV" "True"

echo
echo "== permanent buyer page =="
# seed-demo always names the live hour orynth.dev, which slugifies to orynth-dev.
SLUG="orynth-dev"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/u/$SLUG")
check "buyer page renders" "$CODE" "200"

# The numeric permalink is in confirmation emails already sent; it must not 404.
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/hour/$LIVE_ID")
check "old /hour/:id redirects to the slug" "$LOC" "$BASE/u/$SLUG"

if curl -s "$BASE/u/$SLUG" | grep -q "og:image\" content=\"$BASE/card/$SLUG.png"; then
  ok "buyer page points og:image at its receipt card"
else
  bad "buyer page og:image" "card URL missing from metadata"
fi

TYPE=$(curl -s -o /dev/null -w '%{content_type}' "$BASE/card/$SLUG.png")
check "receipt card renders a PNG" "$TYPE" "image/png"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/card/no-such-product.png")
check "unknown slug has no card" "$CODE" "404"

# The Wall is where the dofollow backlink lives; the buyer page counts clicks instead.
HOME=$(curl -s "$BASE/")
if echo "$HOME" | grep -q 'href="https://blockbuyer.example.com"'; then
  ok "the Wall carries a direct dofollow backlink"
else
  bad "Wall backlink" "no direct anchor to the buyer URL"
fi
if echo "$HOME" | grep -q 'wallbuyer.example.com'; then
  ok "a Wall-only buyer appears on the Wall"
else
  bad "Wall-only entry" "the $25 Wall spot is not on the homepage"
fi

echo
echo "== static pages =="
for p in rules about; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$p")
  check "/$p renders" "$CODE" "200"
done

echo
echo "-----------------------------------------"
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
