#!/usr/bin/env bash
# Disputely: push secrets to Vercel, (re)create the Stripe webhook, write .env.local, run migrations.
# Run from Git Bash:  bash scripts/setup-env.sh
# Reads (never prints):
#   G:\AI Engineering Journey\.env                               GEMINI_API_KEY, GROQ_API_KEY
#   G:\Vibe Engineering Apps\.secrets\stripe-secret.txt          sk_test_...
#   G:\Vibe Engineering Apps\.secrets\disputely-database-url.txt pooled Postgres URL (Neon "Pooled connection")
#   G:\Vibe Engineering Apps\.secrets\disputely-database-direct-url.txt (optional, for migrations)
#   G:\Vibe Engineering Apps\.secrets\disputely-cron-secret.txt, disputely-better-auth-secret.txt, disputely-stripe-price.txt
set -euo pipefail
export PATH="/c/tools/node24:$PATH"
cd "$(dirname "$0")/.."

SECRETS="/g/Vibe Engineering Apps/.secrets"
JOURNEY_ENV="/g/AI Engineering Journey/.env"
PROD_URL="https://getdisputely.vercel.app"
STRIPE="/c/Users/Dell/AppData/Local/Microsoft/WinGet/Packages/Stripe.StripeCli_Microsoft.Winget.Source_8wekyb3d8bbwe/stripe.exe"

read_env() { grep -E "^\s*$2\s*=" "$1" | head -1 | sed -E "s/^\s*$2\s*=\s*//; s/^[\"']//; s/[\"']\s*$//" | tr -d '\r'; }
read_secret() { tr -d '\r\n' < "$1"; }
set_env() { # name value [--sensitive]
  local name="$1" value="$2" flag="${3:-}"
  for target in production preview development; do
    local ok=0
    for attempt in 1 2 3 4; do
      if printf '%s' "$value" | vercel env add "$name" "$target" --force $flag >/dev/null 2>&1; then ok=1; break; fi
      sleep $((5 * attempt))
    done
    [ "$ok" = 1 ] || { echo "FAILED: vercel env add $name $target"; exit 1; }
  done
  echo "  set $name"
}

echo "Collecting values..."
GEMINI=$(read_env "$JOURNEY_ENV" GEMINI_API_KEY)
GROQ=$(read_env "$JOURNEY_ENV" GROQ_API_KEY)
CRON=$(read_secret "$SECRETS/disputely-cron-secret.txt")
AUTH_SECRET=$(read_secret "$SECRETS/disputely-better-auth-secret.txt")
PRICE=$(read_secret "$SECRETS/disputely-stripe-price.txt")
ENC_KEY=$(read_secret "$SECRETS/disputely-app-encryption-key.txt")
STRIPE_SECRET=$(read_secret "$SECRETS/stripe-secret.txt")
case "$STRIPE_SECRET" in sk_test_*) ;; *) echo "stripe-secret.txt must hold a test-mode key"; exit 1;; esac
DB_URL=$(read_secret "$SECRETS/disputely-database-url.txt")
case "$DB_URL" in postgres*) ;; *) echo "disputely-database-url.txt must hold a postgres:// connection string"; exit 1;; esac
DIRECT_URL="$DB_URL"
[ -s "$SECRETS/disputely-database-direct-url.txt" ] && DIRECT_URL=$(read_secret "$SECRETS/disputely-database-direct-url.txt")

echo "Pushing to Vercel (production, preview, development)..."
set_env DATABASE_URL "$DB_URL" --sensitive
set_env BETTER_AUTH_SECRET "$AUTH_SECRET" --sensitive
set_env GOOGLE_GENERATIVE_AI_API_KEY "$GEMINI" --sensitive
set_env GROQ_API_KEY "$GROQ" --sensitive
set_env STRIPE_SECRET_KEY "$STRIPE_SECRET" --sensitive
set_env APP_ENCRYPTION_KEY "$ENC_KEY" --sensitive

echo "Recreating the Stripe webhook endpoint for $PROD_URL ..."
for id in $("$STRIPE" webhook_endpoints list --limit 50 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);for(const w of (j.data||[])) if(w.url===process.argv[1]) console.log(w.id)})' "$PROD_URL/api/webhooks/stripe"); do
  "$STRIPE" webhook_endpoints delete "$id" --confirm >/dev/null 2>&1 && echo "  removed $id"
done
CREATED=$("$STRIPE" webhook_endpoints create --url "$PROD_URL/api/webhooks/stripe" \
  --enabled-events checkout.session.completed \
  --enabled-events customer.subscription.created \
  --enabled-events customer.subscription.updated \
  --enabled-events customer.subscription.deleted \n  --enabled-events charge.dispute.created \n  --enabled-events charge.dispute.updated \n  --enabled-events charge.dispute.closed \n  --enabled-events charge.dispute.funds_withdrawn \n  --enabled-events charge.dispute.funds_reinstated 2>/dev/null)
WHSEC=$(printf '%s' "$CREATED" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.secret||"")})')
[ -n "$WHSEC" ] || { echo "webhook creation failed"; exit 1; }
echo "  created $(printf '%s' "$CREATED" | grep -oE '"id": "we_[A-Za-z0-9]+"' | head -1)"
set_env STRIPE_WEBHOOK_SECRET "$WHSEC" --sensitive

echo "Writing .env.local..."
cat > .env.local <<EOF
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=Disputely
DATABASE_URL=$DB_URL
BETTER_AUTH_SECRET=$AUTH_SECRET
BETTER_AUTH_URL=http://localhost:3000
GROQ_API_KEY=$GROQ
GOOGLE_GENERATIVE_AI_API_KEY=$GEMINI
AI_PRIMARY_MODEL=openai/gpt-oss-20b
AI_FALLBACK_MODEL=gemini-3.5-flash-lite
STRIPE_SECRET_KEY=$STRIPE_SECRET
STRIPE_PRICE_PRO_MONTHLY=$PRICE
STRIPE_WEBHOOK_SECRET=
CRON_SECRET=$CRON
APP_ENCRYPTION_KEY=$ENC_KEY
EMAIL_FROM=Disputely <onboarding@resend.dev>
EOF

echo "Running database migrations (direct URL)..."
DATABASE_URL="$DIRECT_URL" pnpm db:migrate 2>&1 | tail -2
echo "Done. Redeploy with: vercel deploy --prod --yes"
