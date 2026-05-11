# Kick-Off FM — Oracle Cloud Free deployment guide

## What you get

- **Forever-free** ARM Ampere A1 VM: 4 vCPUs, 24 GB RAM, 200 GB block storage
- HTTPS via **Cloudflare Tunnel** (no port forwarding, no certificate management)
- MongoDB Atlas free M0 cluster (already set up)
- Telegram bot already running

## Pre-flight

Before starting, have ready:
- Oracle Cloud account (sign up at <https://www.oracle.com/cloud/free/>)
- Cloudflare account (free, no domain required for Try-Cloudflare tunnels)
- Local repo with `.env` configured (MONGO_URI, JWT_SECRET, BETA_KEY, TELEGRAM_BOT_TOKEN)

## Step 1 — Provision Oracle VM

1. **Sign in** to Oracle Cloud console.
2. **Create Compute Instance**:
   - Image: Canonical Ubuntu 22.04 (or Oracle Linux 8 if Ubuntu unavailable in your region)
   - Shape: `VM.Standard.A1.Flex`. Set: 4 OCPU + 24 GB RAM (full free quota).
   - Networking: keep default VCN, **assign public IPv4**.
   - SSH: paste your `~/.ssh/id_rsa.pub`.
3. Wait until state = Running. Note the **public IP**.
4. **Open ingress** (Subnet → Default Security List → Add Ingress Rule):
   - Source CIDR: `0.0.0.0/0`
   - Protocol: TCP
   - Destination port: `22` (SSH — usually already open)
   - We do **not** need to expose port 3000 — Cloudflare Tunnel makes outbound connections from the VM, not inbound.

If Oracle rejects A1 (low capacity in region), fall back to `VM.Standard.E2.1.Micro` — also free, but only 1 GB RAM. Engine will run, just fewer concurrent matches.

## Step 2 — SSH in & install Docker

```bash
ssh ubuntu@<PUBLIC_IP>

# update + Docker (Ubuntu 22)
sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
newgrp docker      # or log out + back in

# verify
docker --version
docker compose version
```

## Step 3 — Clone repo + write `.env`

```bash
# Pull from your private GitHub repo (or scp locally)
git clone git@github.com:<you>/kickoff-fm.git
cd kickoff-fm

# Copy template + fill in values
cp .env.example .env
nano .env
```

Fill in `.env` (use the same values as your local dev or rotate):

```
NODE_ENV=production
PORT=3000
MONGO_URI=mongodb+srv://...
JWT_SECRET=$(openssl rand -hex 32)
TELEGRAM_BOT_TOKEN=...
BETA_KEY=letmein
PUBLIC_URL=https://<your-cloudflare-host>
```

## Step 4 — Build + run app

```bash
docker compose up -d --build
docker compose logs -f app   # tail
```

Health check:

```bash
curl http://localhost:3000/api/health
# → {"ok":true,"mongo":"up",...}
```

Seed initial world (if not already):

```bash
docker compose exec app node scripts/seed.js
```

## Step 5 — Cloudflare Tunnel (free HTTPS)

This exposes `localhost:3000` on the VM to a public HTTPS URL via outbound connection.

```bash
# Install cloudflared
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared

# Quick option (random *.trycloudflare.com hostname — no Cloudflare account needed):
cloudflared tunnel --url http://localhost:3000
# Output includes:  https://<random-words>.trycloudflare.com
# That's your beta URL — share with friends. Note: random URL changes on each restart.
```

For a **stable URL** with custom hostname:

```bash
# 1. Authenticate browser
cloudflared tunnel login   # follow URL, log into Cloudflare, pick a zone

# 2. Create named tunnel
cloudflared tunnel create kickoff-fm
# Saves credentials at ~/.cloudflared/<UUID>.json

# 3. Create config /etc/cloudflared/config.yml:
sudo tee /etc/cloudflared/config.yml <<EOF
tunnel: kickoff-fm
credentials-file: /home/ubuntu/.cloudflared/<UUID>.json

ingress:
  - hostname: kickoff.example.com    # your CF-managed domain
    service: http://localhost:3000
  - service: http_status:404
EOF

# 4. Route DNS
cloudflared tunnel route dns kickoff-fm kickoff.example.com

# 5. Run as a service
sudo cloudflared service install
sudo systemctl start cloudflared
```

## Step 6 — Verify

Visit your public URL. You should see the SPA login screen. Register an account, link Telegram, claim a team.

## Maintenance

Update app:

```bash
cd ~/kickoff-fm
git pull
docker compose up -d --build
```

Tail logs:

```bash
docker compose logs -f app
```

Restart:

```bash
docker compose restart
```

## Resource notes

- **24 GB RAM** is overkill for engine — easily handles all 60 concurrent matches at peak.
- Oracle's biggest gotcha: occasional out-of-capacity in some regions. If A1 won't provision, try a different region or wait a day.
- Keep `mongo` traffic on TLS — Atlas does this by default.

## Troubleshooting

- `docker compose up` fails with "no permission" → `newgrp docker` or relog SSH session.
- `npm install` for argon2 fails on ARM → ensure base image is `node:22-alpine` (Dockerfile already uses arm-compatible base).
- Mongo connect fails from Oracle → Atlas → Network Access → ensure `0.0.0.0/0` allowed for IP whitelist (or add Oracle public IP).

## Promoting a user to admin (S45)

Admins are set **only via direct MongoDB write** — no UI, no API endpoint that grants admin. Recipe:

```bash
# Either from Atlas Web UI (Browse Collections → users → edit doc → set isAdmin: true)
# or via mongosh / driver:
mongosh "$MONGO_URI"
> use kickoff
> db.users.updateOne({ email: 'youremail@example.com' }, { $set: { isAdmin: true } })
```

The admin guard `app.requireAdmin` (server/plugins/authPlugin.js) checks `isAdmin === true` on every admin-only route.
Sessions issued before promotion stay valid — admin-gated routes re-check the DB each call,
so users see the new permission on their next admin action without re-login.
