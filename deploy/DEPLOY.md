# FlixNova deploy (why the site was stuck)

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
