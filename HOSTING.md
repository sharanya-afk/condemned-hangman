# CONDEMNED — Hosting Guide

## File structure
```
condemned-hangman/
├── server.js          ← Node.js WebSocket + Express server
├── package.json
└── public/
    └── index.html     ← Full client (served as static file)
```

---

## Option 1 — Railway (Recommended · Free tier available)

Railway auto-detects Node.js and handles WebSockets natively.

1. Push your code to a GitHub repo
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Select your repo
4. Railway auto-runs `npm start` — no config needed
5. Go to Settings → Networking → Generate Domain
6. Share the generated URL with your opponent

**Cost:** Free hobby plan (500 hours/month). Upgrade to $5/mo for always-on.

---

## Option 2 — Render (Free tier · Sleeps after 15 min idle)

1. Push to GitHub
2. Go to https://render.com → New → Web Service
3. Connect your repo
4. Set:
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Environment:** Node
5. Click Deploy
6. Share the `.onrender.com` URL

**Note:** Free tier sleeps after 15 min of inactivity. First load takes ~30s.
Upgrade to $7/mo to keep it awake.

---

## Option 3 — VPS (DigitalOcean / Linode / Hetzner)

Best for performance and full control.

```bash
# 1. SSH into your server
ssh root@your-server-ip

# 2. Install Node.js (if not already)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Upload your files (from your local machine)
scp -r ./condemned-hangman root@your-server-ip:/var/www/hangman

# 4. Install dependencies
cd /var/www/hangman
npm install

# 5. Run with PM2 (keeps it alive after SSH disconnect)
npm install -g pm2
pm2 start server.js --name condemned
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot

# 6. Open port 3000 in your firewall
sudo ufw allow 3000

# 7. (Optional) Put Nginx in front on port 80/443
# Install Nginx + Certbot for HTTPS, then add this config:
```

**Nginx config** (`/etc/nginx/sites-available/condemned`):
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;       # Required for WebSockets
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/condemned /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Add HTTPS with Certbot
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---

## Option 4 — Local network (LAN play · No hosting needed)

Play on the same Wi-Fi network:

```bash
npm install
node server.js
```

Find your local IP:
- **Mac/Linux:** `ifconfig | grep "inet 192"`  
- **Windows:** `ipconfig` → look for IPv4 Address

Player 2 opens: `http://192.168.x.x:3000` in their browser.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | Server port |

On Railway/Render, `PORT` is set automatically.

---

## Quick start (local testing)

```bash
cd condemned-hangman
npm install
npm start
# Open http://localhost:3000 in two different browser tabs/windows
# Tab 1: Create Room → note the code
# Tab 2: Enter the code → Join
```

---

## How the word is kept secret

1. Player 1 (setter) types their secret word and sends it to the server
2. The server stores the word in memory for that room only — it is never sent to the guesser's client
3. Letter guesses and whole-word guesses are checked by the **server**, which then tells both clients whether the guess was right or wrong
4. The plaintext word is only sent to both clients after the round ends (win, loss, or surrender)

## Whole-word guessing

The guesser gets exactly **one** whole-word guess per round, usable at any time
during the round (in addition to normal letter-by-letter guessing):

- Right → instant win, round ends immediately
- Wrong → instant loss, round ends immediately — no more letters, no second attempt

Once used (correctly or not), the option disappears for the rest of that round.
