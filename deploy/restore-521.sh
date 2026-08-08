#!/usr/bin/env bash
# Restore FlixNova after Contabo wipe / Cloudflare 521.
# Leaves Nexlify on :80 alone; serves FlixNova on :443 + API :3001.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

APP_DIR=/var/www/moviestream
DOMAIN=snookiebaby.xyz
REPO_URL=https://github.com/snookiebaby2022/MovieStream.git

echo "==> MongoDB 8 for Ubuntu Noble"
rm -f /etc/apt/sources.list.d/mongodb-org-7.0.list
if ! command -v mongod >/dev/null 2>&1; then
  curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
  echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" \
    > /etc/apt/sources.list.d/mongodb-org-8.0.list
  apt-get update -y
  apt-get install -y mongodb-org
fi
systemctl enable --now mongod
sleep 2
systemctl is-active mongod

echo "==> Redis"
systemctl enable --now redis-server 2>/dev/null || systemctl enable --now redis || true

echo "==> Clone FlixNova"
mkdir -p /var/www
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin
  git reset --hard origin/main
else
  rm -rf "$APP_DIR"
  git clone --branch main "$REPO_URL" "$APP_DIR"
fi

echo "==> Env"
if [ -f /tmp/flixnova.env ]; then
  cp /tmp/flixnova.env "$APP_DIR/backend/.env"
elif [ ! -f "$APP_DIR/backend/.env" ]; then
  cp "$APP_DIR/backend/.env.example" "$APP_DIR/backend/.env"
fi
grep -q '^SITE_URL=' "$APP_DIR/backend/.env" || echo 'SITE_URL=https://snookiebaby.xyz' >> "$APP_DIR/backend/.env"
if ! grep -q '^JWT_SECRET=' "$APP_DIR/backend/.env"; then
  echo "JWT_SECRET=$(openssl rand -hex 32)" >> "$APP_DIR/backend/.env"
fi
sed -i 's|^SITE_URL=.*|SITE_URL=https://snookiebaby.xyz|' "$APP_DIR/backend/.env"

cd "$APP_DIR/backend"
npm install --omit=dev

echo "==> Self-signed origin cert for Cloudflare Full SSL"
mkdir -p "/etc/letsencrypt/live/$DOMAIN"
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "/etc/letsencrypt/live/$DOMAIN/privkey.pem" \
    -out "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" \
    -subj "/CN=$DOMAIN" \
    -addext "subjectAltName=DNS:$DOMAIN,DNS:www.$DOMAIN"
fi

echo "==> Nginx on 443/8443 only (Nexlify keeps :80)"
if [ -f /tmp/nginx.flixnova.conf ]; then
  cp /tmp/nginx.flixnova.conf /etc/nginx/sites-available/moviestream
elif [ -f "$APP_DIR/deploy/nginx.flixnova.conf" ]; then
  cp "$APP_DIR/deploy/nginx.flixnova.conf" /etc/nginx/sites-available/moviestream
fi

python3 - <<'PY'
from pathlib import Path
import re
p = Path('/etc/nginx/sites-available/moviestream')
text = p.read_text()
text2 = re.sub(r'# Optional plain HTTP on 8080.*?^}\n\n', '', text, count=1, flags=re.S | re.M)
p.write_text(text2)
PY

ln -sfn /etc/nginx/sites-available/moviestream /etc/nginx/sites-enabled/moviestream
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx
systemctl is-active nginx

echo "==> PM2 FlixNova"
cd "$APP_DIR"
pm2 delete moviestream 2>/dev/null || true
pm2 start ecosystem.config.js --name moviestream
pm2 save
sleep 4
pm2 list
echo "==> Listeners"
ss -lntp | grep -E ':443|:3001|:80' || true
echo -n 'health='
curl -sS http://127.0.0.1:3001/api/health || true
echo
echo -n 'https='
curl -skS -o /dev/null -w '%{http_code}' -H "Host: snookiebaby.xyz" https://127.0.0.1/ || true
echo
echo BOOTSTRAP_DONE
