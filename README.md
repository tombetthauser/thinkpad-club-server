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

### 4) Pull on the Pi + restart the service

SSH to the Pi:

```bash
ssh tom@192.168.1.222
```

Find the directory the service runs from, then pull there:

```bash
systemctl cat thinkpad-server | grep -E "WorkingDirectory|ExecStart"
cd <WORKING_DIRECTORY_FROM_THE_OUTPUT>
git pull
```

Restart and verify:

```bash
sudo systemctl restart thinkpad-server
systemctl status thinkpad-server --no-pager
curl -i http://127.0.0.1:3000/health
```

Finally, from your Mac, confirm:
- `https://thinkpad.club/`
