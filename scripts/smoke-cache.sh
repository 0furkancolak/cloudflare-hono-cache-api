#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3497}"
ACCOUNT_ID="${ACCOUNT_ID:-acc-1}"
PURGE_HMAC_SECRET="${PURGE_HMAC_SECRET:-development-only-change-me}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq bulunamadi. Kurulum: brew install jq"
  exit 1
fi

if ! curl -s "$BASE_URL/" >/dev/null 2>&1; then
  echo "Servis ayakta degil. Once 'bun run dev' ile worker'i baslatin. Beklenen URL: $BASE_URL"
  exit 1
fi

TOKEN="$(ACCOUNT_ID="$ACCOUNT_ID" bun run scripts/generate-dev-jwt.ts)"
PURGE_BODY='{"files":["'"$BASE_URL"'/products/42?__manual=1"],"tags":["products","product:42"],"reason":"smoke-test"}'
SIGNATURE_JSON="$(METHOD=POST PATHNAME=/admin/cache/purge BODY="$PURGE_BODY" PURGE_HMAC_SECRET="$PURGE_HMAC_SECRET" bun run scripts/generate-admin-signature.ts)"
ADMIN_TS="$(echo "$SIGNATURE_JSON" | jq -r '.timestamp')"
ADMIN_SIG="$(echo "$SIGNATURE_JSON" | jq -r '.signature')"

echo
echo "== 1) Servis Bilgisi =="
echo
curl -s "$BASE_URL/" | jq .

echo
echo "== 2) Public Product Ilk Istek (MISS) =="
echo
curl -s -D /tmp/h1.txt "$BASE_URL/products/42" -o /tmp/resp1.json
grep -Ei "HTTP/|X-Cache-Status|X-Cache-Policy|X-Cache-Key|Cache-Control|Content-Type" /tmp/h1.txt
jq . /tmp/resp1.json

echo
echo "== 3) Public Product Ikinci Istek (HIT) =="
echo
curl -s -D /tmp/h2.txt "$BASE_URL/products/42" -o /tmp/resp2.json
grep -Ei "HTTP/|X-Cache-Status|X-Cache-Policy|X-Cache-Key|Cache-Control|Content-Type" /tmp/h2.txt
jq . /tmp/resp2.json

echo
echo "== 4) Private Profile Ilk Istek (MISS) =="
echo
curl -s -D /tmp/h3.txt "$BASE_URL/accounts/$ACCOUNT_ID/profile" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-account-id: $ACCOUNT_ID" \
  -o /tmp/profile1.json
grep -Ei "HTTP/|X-Cache-Status|X-Cache-Policy|X-Cache-Key|Cache-Control|Content-Type" /tmp/h3.txt
jq . /tmp/profile1.json

echo
echo "== 5) Private Profile Ikinci Istek (HIT) =="
echo
curl -s -D /tmp/h4.txt "$BASE_URL/accounts/$ACCOUNT_ID/profile" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-account-id: $ACCOUNT_ID" \
  -o /tmp/profile2.json
grep -Ei "HTTP/|X-Cache-Status|X-Cache-Policy|X-Cache-Key|Cache-Control|Content-Type" /tmp/h4.txt
jq . /tmp/profile2.json

echo
echo "== 5a) Private Photos Feed Ilk Istek (MISS, upstream + encrypt) =="
echo
curl -s -D /tmp/h4a.txt "$BASE_URL/accounts/$ACCOUNT_ID/photos-feed" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-account-id: $ACCOUNT_ID" \
  -o /tmp/photos1.json
grep -Ei "HTTP/|X-Cache-Status|X-Cache-Policy|X-Cache-Key|Cache-Control|Content-Type" /tmp/h4a.txt
jq '{source, multiplier, count, firstId: .photos[0].id, lastId: .photos[-1].id}' /tmp/photos1.json
echo "Not: encrypt/decrypt sure metrikleri icin worker loglarina bakin (displayValue, bodyBytes)."

echo
echo "== 5b) Private Photos Feed Ikinci Istek (HIT, decrypt) =="
echo
curl -s -D /tmp/h4b.txt "$BASE_URL/accounts/$ACCOUNT_ID/photos-feed" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-account-id: $ACCOUNT_ID" \
  -o /tmp/photos2.json
grep -Ei "HTTP/|X-Cache-Status|X-Cache-Policy|X-Cache-Key|Cache-Control|Content-Type" /tmp/h4b.txt
jq '{source, multiplier, count, firstId: .photos[0].id, lastId: .photos[-1].id}' /tmp/photos2.json

echo
echo "== 6) Critical Balance (BYPASS) =="
echo
curl -s -D /tmp/h5.txt "$BASE_URL/accounts/$ACCOUNT_ID/balance" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-account-id: $ACCOUNT_ID" \
  -o /tmp/balance.json
grep -Ei "HTTP/|X-Cache-Status|X-Cache-Policy|X-Cache-Key|Cache-Control|Content-Type" /tmp/h5.txt
jq . /tmp/balance.json

echo
echo "== 7) Product Mutation + Purge =="
echo
curl -s -X POST "$BASE_URL/products/42" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Product-42-Updated"}' | jq .

echo
echo "== 8) Mutation Sonrasi Public Product (MISS, yeni veri) =="
echo
curl -s -D /tmp/h6.txt "$BASE_URL/products/42" -o /tmp/resp6.json
grep -Ei "HTTP/|X-Cache-Status|X-Cache-Policy|X-Cache-Key|Cache-Control|Content-Type" /tmp/h6.txt
jq . /tmp/resp6.json

echo
echo "== 9) Profile Mutation + Purge =="
echo
curl -s -X POST "$BASE_URL/accounts/$ACCOUNT_ID/profile" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-account-id: $ACCOUNT_ID" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Tenant-Updated"}' | jq .

echo
echo "== 10) Admin Purge Endpoint (HMAC) =="
echo
curl -s -X POST "$BASE_URL/admin/cache/purge" \
  -H "Content-Type: application/json" \
  -H "x-admin-timestamp: $ADMIN_TS" \
  -H "x-admin-signature: $ADMIN_SIG" \
  -d "$PURGE_BODY" | jq .
