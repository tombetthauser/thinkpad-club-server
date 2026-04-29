# thinkpad-club-server

Minimal Node server that serves static files from `public/`.

## Local run

```bash
node server.js
```

Then open `http://127.0.0.1:3000`.

## Health check

```bash
curl -i http://127.0.0.1:3000/health
```

## Edit -> Test Locally -> Push -> Deploy on Pi

### 1) Make changes

Edit files in:
- `public/` (HTML/CSS/JS served to the browser)
- `server.js` (HTTP server behavior)

### 2) Test locally (Mac)

Run the server locally on a port:

```bash
PORT=3000 node server.js
```

Test:

```bash
curl -i http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3000/
```

Open in a browser:
- `http://127.0.0.1:3000/`

Stop the server with `Ctrl+C` when done.

### 3) Commit + push

```bash
git status
git add public/ server.js
git commit -m "Describe the change"
git push origin main
```

### 4) Deploy on the Pi

Recommended: run the deploy helper (does `git pull`, restarts `thinkpad-server`, and retries `/health`):

```bash
ssh tom@192.168.1.222 '/usr/local/bin/deploy-thinkpad-server.sh'
```

If you want to do it manually instead (fallback):

```bash
ssh tom@192.168.1.222
systemctl cat thinkpad-server | grep -E "WorkingDirectory|ExecStart"
cd <WORKING_DIRECTORY_FROM_THE_OUTPUT>
git pull
sudo systemctl restart thinkpad-server
systemctl status thinkpad-server --no-pager
curl -i http://127.0.0.1:3000/health
```

Finally, from your Mac, confirm:
- `https://thinkpad.club/`
