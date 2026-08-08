# FlixNova deploy (why the site was stuck)

## Error 521 (Cloudflare) — origin web server down

`521` means Cloudflare reached the DNS record but **could not open TCP to your VPS on the origin HTTPS port (443)**.

Typical causes on this stack:

1. **VPS reinstalled / wiped** (SSH host key changes, nginx + Node gone)
2. **nginx not listening on 443** (or firewall blocking 443)
3. **PM2 / API dead** (site HTML may still load via nginx; API will fail separately)
4. Cloudflare SSL mode **Full/Full strict** while origin has no SSL listener

Quick checks from your PC:

```powershell
curl.exe -sI https://snookiebaby.xyz
# Probe origin (Contabo IP), not Cloudflare:
curl.exe -sI http://75.119.137.174/
# 443 must be OPEN for Full SSL:
# Connection refused on 443 + 521 on the domain = this exact failure mode
```

### Complete recovery after Contabo reinstall

You must restore SSH first (no deploy can run until keys work again):

1. Contabo Customer Control Panel → your VPS → **VNC / Console** (or reset root password)
2. As root, authorize your laptop key:

```bash
mkdir -p /root/.ssh
chmod 700 /root/.ssh
echo 'PASTE_YOUR_id_ed25519.pub_LINE_HERE' >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
```

3. Contabo firewall / security group: allow **22, 80, 443**
4. From your PC, bootstrap the whole stack:

```powershell
# after SSH works:
ssh root@75.119.137.174 'bash -s' < deploy/bootstrap-vps.sh
# then restore production secrets:
scp backend/.env root@75.119.137.174:/var/www/moviestream/backend/.env
ssh root@75.119.137.174 'pm2 restart moviestream --update-env'
```

5. Cloudflare dashboard → SSL/TLS → set **Full** (use **Full (strict)** once Let’s Encrypt certs exist)
6. Confirm:

```powershell
curl.exe -sI https://snookiebaby.xyz
curl.exe -s https://snookiebaby.xyz/api/health
```

`bootstrap-vps.sh` installs nginx, Node 20, PM2, MongoDB, Redis, clones the repo, obtains certs when possible, and starts FlixNova.

---

GitHub Actions **Deploy to Server** has been failing with:

```text
Error: missing server host
```

That means these GitHub secrets are empty / missing:

| Secret | Example |
|--------|---------|
| `SERVER_HOST` | your VPS IP (not Cloudflare proxy IP) |
| `SERVER_USER` | `root` or `ubuntu` |
| `SSH_PRIVATE_KEY` | full private key PEM (`-----BEGIN …-----`) |
| `SERVER_PORT` | `22` (optional) |

Without those, pushes go to GitHub but **never reach** `/var/www/moviestream`.

## Option A — Fix auto-deploy (recommended)

1. Open https://github.com/snookiebaby2022/MovieStream/settings/secrets/actions  
2. Add the secrets above  
3. Actions → **Deploy to Server** → **Run workflow**

Or from a PC with `gh` logged in:

```bash
gh secret set SERVER_HOST -R snookiebaby2022/MovieStream -b "YOUR_VPS_IP"
gh secret set SERVER_USER -R snookiebaby2022/MovieStream -b "root"
gh secret set SERVER_PORT -R snookiebaby2022/MovieStream -b "22"
gh secret set SSH_PRIVATE_KEY -R snookiebaby2022/MovieStream < ~/.ssh/id_ed25519
gh workflow run "Deploy to Server" -R snookiebaby2022/MovieStream
```

## Option B — Deploy manually on the VPS (works immediately)

SSH into the machine that hosts FlixNova, then:

```bash
cd /var/www/moviestream
git fetch origin
git reset --hard origin/main
cd backend
npm install --omit=dev
pm2 restart moviestream --update-env
# if nginx serves files from disk:
sudo nginx -t && sudo systemctl reload nginx
```

Then hard-refresh the browser: **Ctrl+F5** (or clear site data — service worker).

## Option C — From your Windows PC

```powershell
cd C:\Users\lizzi\MovieStream\deploy
.\deploy-remote.ps1 -HostName YOUR_VPS_IP -User root
```

## After deploy you should see

- Top bar: **Sign Up** + **Log In**
- Welcome popup on first visit
- Watch gate when pressing Play while logged out
- **Ad-Free £1** promo for free logged-in users
