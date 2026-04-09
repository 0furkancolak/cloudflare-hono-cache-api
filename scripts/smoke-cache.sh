#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3497}"
SECRET="${SECRET:-change-production}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq bulunamadi. Kurulum: brew install jq"
  exit 1
fi

echo
echo "== 1) Servis Bilgisi =="
echo
curl -s "$BASE_URL/" | jq .

echo
echo "== 2) Products Ilk Istek (MISS) =="
echo
curl -s -D /tmp/h1.txt "$BASE_URL/products/42" -o /tmp/resp1.json
grep -Ei "HTTP/|X-Cache-Status|Cache-Control|Content-Type" /tmp/h1.txt
jq . /tmp/resp1.json

echo
echo "== 3) Products Ikinci Istek (HIT) =="
echo
curl -s -D /tmp/h2.txt "$BASE_URL/products/42" -o /tmp/resp2.json
grep -Ei "HTTP/|X-Cache-Status|Cache-Control|Content-Type" /tmp/h2.txt
jq . /tmp/resp2.json

echo
echo "== 4) Product Update + Invalidate =="
echo
curl -s -X POST "$BASE_URL/products/42/update" \
  -H "Content-Type: application/json" \
  -d '{"name":"Product-42-Updated"}' | jq .

echo
echo "== 5) Update sonrasi Products (MISS, yeni veri) =="
echo
curl -s -D /tmp/h5.txt "$BASE_URL/products/42" -o /tmp/resp5.json
grep -Ei "HTTP/|X-Cache-Status|Cache-Control|Content-Type" /tmp/h5.txt
jq . /tmp/resp5.json

echo
echo "== 6) /me (Auth yok) =="
echo
curl -s -D /tmp/h3.txt "$BASE_URL/me" -o /tmp/me1.json
grep -Ei "HTTP/|X-Cache-Status|Content-Type" /tmp/h3.txt
jq . /tmp/me1.json

echo
echo "== 7) /me (Auth var -> BYPASS) =="
echo
curl -s -D /tmp/h4.txt "$BASE_URL/me" -H "Authorization: Bearer demo-token" -o /tmp/me2.json
grep -Ei "HTTP/|X-Cache-Status|Content-Type" /tmp/h4.txt
jq . /tmp/me2.json

echo
echo "== 8) Internal Invalidate =="
echo
curl -s -X POST "$BASE_URL/products/42/refresh" | jq .

echo
echo "== 9) Secret Endpoint Invalidate =="
echo
curl -s -X POST "$BASE_URL/cache/invalidate" \
  -H "Content-Type: application/json" \
  -H "x-cache-secret: $SECRET" \
  -d '{"urls":["/products/42"],"tags":["products","product:42"]}' | jq .
