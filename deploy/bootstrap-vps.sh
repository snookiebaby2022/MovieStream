#!/usr/bin/env bash
# FlixNova full VPS bootstrap — use after Contabo reinstall / Error 521
# Run as root in Contabo VNC/console OR after SSH is restored:
#   curl -fsSL https://raw.githubusercontent.com/snookiebaby2022/MovieStream/main/deploy/bootstrap-vps.sh | bash
# Or copy this file up and: bash bootstrap-vps.sh
#
# Required beforehand:
#   1) Contabo firewall allows TCP 22, 80, 443
#   2) Cloudflare DNS A record for snookiebaby.xyz → this VPS IP (proxied orange cloud OK)
#   3) Cloudflare SSL/TLS mode = Full (or Full strict after certs exist)
#   4) Restore backend/.env (from backup) after clone, before pm2 start

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/moviestream}"
REPO_URL="${REPO_URL:-https://github.com/snookiebaby2022/MovieStream.git}"
DOMAIN="${DOMAIN:-snookiebaby.xyz}"
BRANCH="${BRANCH:-main}"

export DEBIAN_FRONTEND=noninteractive

echo "==> Updating packages"
apt-get update -y
apt-get install -y curl ca-certificates gnupg ufw git nginx certbot python3-certbot-nginx

echo "==> Node 20"
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE '^v2[0-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

echo "==> MongoDB 7"
if ! command -v mongod >/dev/null 2>&1; then
  curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
  echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" \
    > /etc/apt/sources.list.d/mongodb-org-7.0.list
  apt-get update -y
  apt-get install -y mongodb-org || apt-get install -y mongodb
fi
systemctl enable --now mongod 2>/dev/null || systemctl enable --now mongodb 2>/dev/null || true

echo "==> Redis"
apt-get install -y redis-server
systemctl enable --now redis-server 2>/dev/null || systemctl enable --now redis 2>/dev/null || true

echo "==> Firewall"
ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw --force enable || true

echo "==> App code at $APP_DIR"
mkdir -p /var/www
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin
  git reset --hard "origin/$BRANCH"
else
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR/backend"
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "WARNING: created backend/.env from example — restore secrets before expecting streams/auth to work"
  else
    echo "ERROR: missing backend/.env — copy your production env then re-run"
    exit 1
  fi
fi

npm install --omit=dev

echo "==> Nginx site"
if [ -f "$APP_DIR/deploy/nginx.flixnova.conf" ]; then
  cp "$APP_DIR/deploy/nginx.flixnova.conf" /etc/nginx/sites-available/moviestream
  ln -sfn /etc/nginx/sites-available/moviestream /etc/nginx/sites-enabled/moviestream
  rm -f /etc/nginx/sites-enabled/default
fi

# Temporary HTTP-only server so certbot can obtain certs if 443 SSL files missing
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  cat >/etc/nginx/sites-available/moviestream-bootstrap <<EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    root $APP_DIR/website;
    index index.html;
    location ^~ /.well-known/acme-challenge/ { root /var/www/html; }
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location / { try_files \$uri \$uri/ /index.html; }
}
EOF
  ln -sfn /etc/nginx/sites-available/moviestream-bootstrap /etc/nginx/sites-enabled/moviestream
  mkdir -p /var/www/html
  nginx -t && systemctl enable --now nginx && systemctl reload nginx

  echo "==> Obtaining Let's Encrypt cert (Cloudflare must be DNS-only OR Flexible briefly, OR use DNS challenge)"
  echo "    If certbot fails while orange-cloud is on, set CF SSL to Flexible temporarily OR pause proxy, then retry."
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || true
fi

# Prefer full FlixNova nginx once certs exist
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] && [ -f "$APP_DIR/deploy/nginx.flixnova.conf" ]; then
  cp "$APP_DIR/deploy/nginx.flixnova.conf" /etc/nginx/sites-available/moviestream
  ln -sfn /etc/nginx/sites-available/moviestream /etc/nginx/sites-enabled/moviestream
  rm -f /etc/nginx/sites-enabled/moviestream-bootstrap
fi

nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "==> PM2"
cd "$APP_DIR"
pm2 delete moviestream 2>/dev/null || true
pm2 start ecosystem.config.js --name moviestream
pm2 save
pm2 startup systemd -u root --hp /root | tail -n 1 | bash || true

echo "==> Local checks"
sleep 2
ss -lntp | grep -E ':80|:443|:3001' || true
curl -sS -o /dev/null -w "local_api=%{http_code}\n" http://127.0.0.1:3001/api/health || true
curl -sS -o /dev/null -w "local_http=%{http_code}\n" -H "Host: $DOMAIN" http://127.0.0.1/ || true
curl -skS -o /dev/null -w "local_https=%{http_code}\n" -H "Host: $DOMAIN" "https://127.0.0.1/" || true

echo ""
echo "BOOTSTRAP_OK"
echo "Next:"
echo "  1) Restore full secrets into $APP_DIR/backend/.env and: pm2 restart moviestream --update-env"
echo "  2) Cloudflare SSL/TLS = Full (strict) once local_https=200"
echo "  3) Re-add deploy SSH public key to /root/.ssh/authorized_keys for GitHub Actions"
echo "  4) Verify: curl -I https://$DOMAIN/"
