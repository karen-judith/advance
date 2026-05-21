#!/bin/bash
# Generate traffic for Advance Trading platform
BASE="http://localhost:5000/api"

echo "=== Generating traffic for Advance Trading ==="

# 1. Get prices (many times for metrics)
for i in $(seq 1 20); do
  curl -s "$BASE/precios" > /dev/null
  echo "GET /precios [$i]"
  sleep 0.2
done

# 2. Try successful login flow (will fail 3 times then succeed)
for i in $(seq 1 3); do
  curl -s -X POST "$BASE/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"wrong@email.com","password":"wrongpass"}' > /dev/null
  echo "POST /login - WRONG [$i]"
done

curl -s -X POST "$BASE/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@advance.com","password":"123456"}' > /dev/null
echo "POST /login - OK"

# 3. Try to register (will fail because demo exists)
curl -s -X POST "$BASE/register" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Test","email":"demo@advance.com","password":"test123","telefono":"1234567890"}' > /dev/null
echo "POST /register - DUPLICATE"

# 4. Hit transaction history & other endpoints
curl -s "$BASE/user/1/transaction-history" > /dev/null
echo "GET /user/1/transaction-history"

curl -s "$BASE/usuario/1/portafolio" > /dev/null
echo "GET /usuario/1/portafolio"

curl -s "$BASE/user/1/financial-summary" > /dev/null
echo "GET /user/1/financial-summary"

curl -s "$BASE/usuario/1/access-log" > /dev/null
echo "GET /usuario/1/access-log"

# 5. More random traffic
for i in $(seq 1 10); do
  case $((RANDOM % 5)) in
    0) curl -s "$BASE/precios" > /dev/null ;;
    1) curl -s -X POST "$BASE/login" -H "Content-Type: application/json" \
         -d "{\"email\":\"user$i@test.com\",\"password\":\"pass$i\"}" > /dev/null ;;
    2) curl -s "$BASE/user/1/transaction-history" > /dev/null ;;
    3) curl -s "$BASE/usuario/1/portafolio" > /dev/null ;;
    4) curl -s "$BASE/user/1/financial-summary" > /dev/null ;;
  esac
  echo "RANDOM traffic [$i]"
  sleep 0.3
done

echo "=== Traffic generation complete ==="
echo ""
echo "Now open Grafana at http://localhost:3101"
echo "User: admin / Password: advance2024"
echo ""
echo "To see metrics:  Explore > Prometheus > query: http_request_duration_seconds_count"
echo "To see traces:   Explore > Tempo > Search > look for recent traces"
echo "To see logs:     Explore > Loki > query: {job=\"advance-trading\"} |= \`login\`"
