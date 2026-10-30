# ThinkPad Club

A small website-making playground for students. Make a page by choosing an address,
edit its HTML and CSS, and save it on the club's server. No database, account system,
package installation, or build step is required.

## Start it on your computer

Install Node.js 22 or newer, open a terminal in this project folder, and run:

```bash
node server.js
```

Open **http://127.0.0.1:3000/**. Leave the terminal running while you use the site.
Press **Ctrl+C** to stop it.

These instructions start a local copy. They do not update the live thinkpad.club
website. The live server must run this version of the code to offer these features.

## For students: your page is like a notebook

Think of the club website as a shelf of notebooks. Each page has an address, like a
name on its cover. The server is the computer that keeps the notebooks safe.

### Make your first page

Click **Make a new page** on the homepage and enter a name, such as
`chocolate-dolphin`. Spaces become hyphens and letters become lowercase. The
site opens `/edit/chocolate-dolphin`, where you can edit the full HTML document.
Click **Save**, then **View** to see your page at `/chocolate-dolphin`.
Visiting an editor does not create a file; the first Save does.

Pages are shared. Choosing an existing name opens that page's existing code;
ask before changing someone else's work. Names contain lowercase letters,
numbers, and single hyphens, up to 64 characters. System route names are reserved.

### View and edit separately

Public pages show only page content. Open `/edit/<page-name>` to edit a page, or
`/edit/index` for the homepage. The editor has a black background, a code area,
and Save, View, MDN, and W3Schools HTML links at the top. It starts in full HTML
mode. Save keeps the editor open and reports success without reloading.

**Preview** displays your current unsaved HTML in a frame in the editor.
Click Preview again to refresh it after edits, or Close preview to hide it. Preview
does not save or upload your draft. Student JavaScript runs in this draft preview. Shared webcam controls are attached
when you view the saved page.

**Random HTML** asks for confirmation before replacing the entire draft with a
random science or math page and deliberately odd CSS. Cancel keeps your work.
The saved page changes only when you click Save.

Expand **Tools** for element insertion, styles, webcam markup, image uploads,
simple code view, and Reset. Reset immediately saves a starter document and has
no undo history. Editing source or adding elements is not saved until Save.

### Put a picture on your page

1. Open **Tools** below the code box and click **Upload image**.
2. Choose a PNG, JPEG, GIF, or WebP picture no bigger than 5 MB.
3. The site uploads it and adds code like this:

   ```html
   <img src="/uploads/a-generated-name.png" alt="Describe your image">
   ```

4. Replace `Describe your image` with a helpful description, such as
   `Our cardboard robot with blue wheels`. This helps people who cannot see the image.
5. Move the image code somewhere else in the body if you want.
6. Click **Save**.

The uploaded image's code also appears in a separate box so you can copy it.
The picture itself is uploaded right away; the page's image tag is saved when you
click Save. Use the URL the site gives you. Images on other websites are not
loaded in this version.

### Add the club webcam

1. Open **Tools** below the code box and click **Add webcam**.
2. Click **Save** to save the webcam block on your page.
3. Use the block's **Update webcam image** button to take a fresh photo.

This uses the USB webcam connected to the **club server**, not the camera on your
computer. It shows the latest still photo, not a streaming video. Photos are taken
only when someone clicks the webcam update button; visiting a page does not turn
on the camera. If the server has a class password, the webcam update button prompts for it.
The password stays only in memory for the current page load.

You can change the heading, description, image size, or button text in your code.
Keep the `data-webcam`, `data-webcam-image`, `data-webcam-update`, and
`data-webcam-status` attributes so the button keeps working. No JavaScript needs
to be added to your page.

All pages use the same club webcam and latest photo. A capture replaces that
shared photo. Other open pages show the new picture when reloaded or when their
webcam update button is clicked. If the camera is unplugged, the button explains
what went wrong and the last successful photo stays available.

### Where does my work go?

Clicking Save is like putting your notebook back on the shelf. The server saves
a file, so your page stays there when you close your browser or restart the server.
Someone using another computer can see it if they connect to the same server.

The code you are still typing is **not saved yet**. Click Save before leaving.
Reset saves right away and replaces what was there; there is no undo history.

Pages are visible to anyone who can reach this server. Use a nickname or a project
name, and keep private information out of your pages and pictures.

## For teachers and developers

### Robot controls

Optional Raspberry Pi motor controls are available at `/control`.
Hold Forward, Backward, Rotate left, or Rotate right; release to stop. The speed
slider starts at 30% and allows up to 60%. Dance makes three pairs of short
left/right turns, with stopped pauses; STOP cancels it. Motor controls are disabled
by default and require explicit enablement and a Python GPIO worker. No robot
password is required; anyone who can reach the server can operate the enabled robot.
The existing page editor and webcam routes keep their existing access rules.

Three files implement the controls: `public/control.html` contains the plain HTML
and browser script, `lib/robot.js` connects Node to Python, and `lib/motors.py`
owns the GPIO pins and independent 500 ms watchdog. There is no robot stylesheet,
separate browser script, keyboard control, calibration interface, or second page.

On Raspberry Pi OS, install `python3-gpiozero` and give the service user GPIO
device access (normally membership in the `gpio` group). Use the Pi's system
Python rather than a copied Mac virtual environment. For this chassis:

```bash
ROBOT_ENABLED=1 ROBOT_PYTHON=/usr/bin/python3 ROBOT_INVERT_RIGHT=1 node server.js
```

When using systemd, set those variables in `thinkpad-server.service` and restart
the service. Run only one GPIO controller at a time. The default Node bind address
is still `127.0.0.1`; for the HTTPS reverse proxy, set `PUBLIC_ORIGIN` to the exact
website origin. No password is required for motor commands.

BCM17/27 (physical pins 11/13) connect to IN1/IN2 for the left motor;
BCM22/23 (physical pins 15/16) connect to IN3/IN4 for the right motor.
Pi ground, driver ground, and motor battery negative share ground. Motor battery
positive connects only to driver VCC; Pi USB power stays separate. GPIO14/15 are
reserved for UART. The owner confirmed this board needed J2 bridged and solder
repairs before both motors worked; that does not establish other boards' jumper
configuration. The right motor requires `ROBOT_INVERT_RIGHT=1` on this chassis.

Optional pin variables are `ROBOT_LEFT_FORWARD`, `ROBOT_LEFT_BACKWARD`,
`ROBOT_RIGHT_FORWARD`, and `ROBOT_RIGHT_BACKWARD`. Set `ROBOT_INVERT_LEFT=1`
if the left motor's polarity needs reversing. Restart after configuration changes.

Test with wheels raised and USB cable slack. Check each direction, release-to-stop,
Stop, and Dance at a low speed. Dance makes six nominal 150 ms turns separated by
100 ms stopped pauses; network latency affects timing and angle. Stop, changing
tabs, losing focus, or leaving the page cancels movement. Disconnect the browser
network while moving to verify that outputs stop within 500 ms of the last
accepted command, plus scheduling latency. Stop the service while moving to
verify shutdown cleanup. State text describes commands, not measured wheel motion.
Stop removes drive power; the wheels may coast. Disconnect the motor battery to
physically remove motor power.

Movement uses `POST /api/robot/{forward,backward,left,right,stop}`, JSON speed from
0 to 0.6, and a per-tab `X-Robot-Controller` UUID. Cross-origin requests are
rejected and only one tab can drive at a time; any tab can stop it. Python stops
on expiry, EOF, signals, or command errors. Worker failure requires a server
restart; movement is never replayed automatically.

Run `node --test` and `python3 -B -m unittest discover -s test -p 'test_*.py'`
for software checks without GPIO hardware.

### How a page is made

The app uses Node's built-in HTTP server and the filesystem. Public pages render
directly from their HTML files, with a shared script for webcam controls and the
new-page prompt. Student JavaScript, inline event handlers, and external scripts
are allowed. No sandbox or script-blocking policy is applied to student pages or
the editor's unsaved preview. The editor remains at a separate `/edit/...` URL.

`/edit/chocolate-dolphin` loads the separate shared editor and fetches the HTML
from `GET /api/pages/chocolate-dolphin`. Save sends that HTML to the existing PUT
endpoint. Each page is still an independent HTML file; no database or build step
is required.

The homepage uses storage name `index`. If there is no saved override it reads
`public/index.html`. **A saved `data/pages/index.html` still takes precedence.**
To use the new default homepage on an existing deployment, back up that saved
file and move it out of the pages directory, or paste the new `public/index.html`
into `/edit/index` and Save. Deployments never overwrite student pages automatically.
`/index` and `/index.html` redirect to `/`.

### Files and responsibilities

```text
server.js             HTTP routes, write access, uploads, response policies
lib/pages.js          Page naming, starter documents, file reads and atomic saves
lib/webcam.js         USB webcam capture, latest photo, and photo archive
public/index.html     Default home content, without editor controls
public/viewer.html    Standalone public page viewer
public/viewer.js      Webcam updates, new-page prompt, and link navigation
public/viewer.css     Full-window page frame
public/editor.html    Separate code editor controls
public/editor.js      Editing, code views, buttons, saves, and uploads
public/editor.css     Small layout rules for the shared editor

data/pages/           Saved student HTML, created on first save
  dannys-page.html
  index.html          Saved homepage override, if someone updates the home page

data/uploads/         Uploaded images with generated filenames
  <generated-id>.png

test/server.test.js   HTTP integration tests using temporary data directories
test/editor.test.js   Editor save, reset, upload, and button handler tests
test/webcam.test.js   Camera capture, failure, archive, and concurrency tests
archive/              Snapshot of the previous project
```

Each page file is a complete HTML document with its own inline CSS. It contains
student content, not a copy of the shared editor. "Show all code" means the full
**student document**, not the editor application's source.

The simple view changes head styles and body content while retaining other head
metadata. The full view also lets students edit the document head. It does not
change the shared editor's code. Use the same Add buttons in either view.

### Persistence: files, not browser storage

- Pages are UTF-8 `.html` files in `data/pages/`.
- Images are binary files in `data/uploads/`.
- A save writes to a uniquely named temporary file in the page directory and then
  renames it over the destination. Readers do not receive a half-written page.
- **No page content or password is stored in localStorage or sessionStorage.**
- Unsaved edits live in browser memory. They are lost if the tab is discarded.
- The editor starts in full HTML mode on each visit and uses no browser storage.
- The class password is kept in the password input for the current page load;
  re-enter it after a reload.

The data must live on a persistent, writable disk. Restarting Node does not erase
it. Replacing or deleting the server's disk does. Separate local and live servers
have separate data; there is no automatic synchronization between them.

### Configuration and class access

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listening port. |
| `HOST` | `127.0.0.1` | Listening address. The default is local access or access through a reverse proxy. |
| `DATA_DIR` | This project's `data/` directory | Storage location. Prefer an absolute path when setting it. |
| `EDIT_PASSWORD` | Empty | Optional shared class password required for saves, resets, uploads, and webcam captures. |
| `WEBCAM_DIR` | `~/Pictures/Webcam` for the Node service user | Latest webcam photo and archive location, matching the old app. |
| `WEBCAM_DEVICE` | `/dev/video0` | Linux USB camera device passed to fswebcam. |
| `PUBLIC_ORIGIN` | Check the request's host | Exact browser-facing origin for write checks, for example `https://thinkpad.club`. No trailing slash. |

Example local run with a class password:

```bash
EDIT_PASSWORD='choose-a-class-password' node server.js
```

With no `EDIT_PASSWORD`, anyone who can reach the server can edit every page and
upload images or take webcam photos. With a password, reading stays public, and anyone who knows the
password can edit any page. This is shared class access, not individual ownership.
There are no student accounts, private pages, or per-page permissions.

For a live setup, set the class password in the server's environment, use HTTPS
through a reverse proxy, and set `PUBLIC_ORIGIN=https://thinkpad.club`. Have the
proxy forward requests to Node on `127.0.0.1:3000`. Do not set the password in a
tracked source file. This change does not alter or deploy the Raspberry Pi service.

To deliberately allow other computers on a trusted classroom network to reach a
local server directly, set `HOST=0.0.0.0` and use that computer's LAN address in
student browsers. `127.0.0.1` on each student's computer refers to their own computer,
not the teacher's. Shared passwords sent over plain HTTP are unencrypted; use the
HTTPS-hosted version for internet access.

### Webcam setup on the Pi

The webcam integration uses `fswebcam` with 1920×1080 YUYV (uncompressed) input
and JPEG quality 95. The camera must support that capture mode. On the Pi,
install `fswebcam` if it is not already installed, connect
the USB webcam, and make sure the Node service user has permission to access
`/dev/video0` (normally through the Linux `video` group).

The Node service user must also be able to write to its `~/Pictures/Webcam`
directory. If the old app ran as a different user, set `WEBCAM_DIR` to that old
photo directory or choose a new writable directory. Environment variables belong
in the service configuration when running through systemd.

The app runs `fswebcam` directly with argument arrays, not a shell. It skips 20
frames, waits at most 20 seconds, and allows only one capture at a time per server
process. A capture goes into a temporary JPEG first. Only a successful capture
replaces `current.jpg`; the previous photo is copied into `archive/`. Images are
served without browser caching. No background capture loop runs. Captures may take several seconds with the uncompressed mode.

The shared page script handles webcam controls without requiring students to
write their own capture code. Capture keeps the password and origin checks used
for saving. Webcam archives are not served or automatically pruned.

### API routes

| Request | Behavior |
| --- | --- |
| `GET /` or `GET /<page-name>` | Public page viewer without editor controls. |
| `GET /edit/<page-name>` | Separate code editor; use `/edit/index` for home. |
| `GET /api/pages/<page-name>` | JSON: `html`, `saved`, `starter`, `passwordRequired`. |
| `PUT /api/pages/<page-name>` | Saves the raw HTML request body; requires `Content-Type: text/html`. |
| `GET /api/pages/<page-name>/preview` | Renders the student's HTML with restrictive browser policies. |
| `POST /api/uploads` | Accepts raw image bytes, returns JSON containing `url` and an `html` image tag. |
| `GET /uploads/<generated-filename>` | Serves an uploaded image. |
| `GET /assets/editor.js` and `/assets/editor.css` | Shared editor assets. |
| `POST /api/webcam/capture` | Takes a fresh photo and returns a cache-busting image `url`. |
| `GET /webcam/current.jpg` | Latest shared webcam photo; no capture is triggered by reading it. |
| `GET /health` | Returns `ok`. |

If a class password is configured, send it in `X-Edit-Password` for PUT and upload
and webcam capture requests. The browser editor does this for you. Writes from other browser origins
are rejected. CORS is not enabled. The previous single-page `/api/page` endpoint
has been replaced with the per-page API.

### Boundaries and deliberate simplifications

- Page names are 1–64 lowercase letters, digits, and single separating hyphens.
  `api`, `assets`, `uploads`, `health`, `webcam`, `robot`, `control`, and `edit` are reserved. Nested page paths, filename
  extensions, and path traversal are rejected. A trailing slash redirects to the
  canonical address.
- The HTML limit is 1 MB; the image limit is 5 MB. Images get generated filenames
  rather than trusting the original name. File signatures select PNG, JPEG, GIF,
  or WebP; this is a format check, not full image decoding or malware scanning.
  SVG and arbitrary file uploads are unsupported.
- Student JavaScript runs as ordinary same-origin website code, including in
  unsaved previews. Pages can load external scripts and resources. The editor's
  full HTML mode allows editing scripts directly.
- Uploaded images are public by URL. Uploads are stored immediately and are not
  deleted by resetting a page or removing its image tag. There is no image cleanup
  interface or total-storage quota yet.
- Two people can edit one page at once; the last successful save wins. There is no
  revision history, automatic merging, or restore button for earlier versions.
- Unknown URLs show a starter page with HTTP 200. Simply viewing them does not
  create a file, but they are not conventional 404 pages. There is no page listing
  or search feature yet.
- Only explicit app routes are served. The archive, documentation, page storage
  directory, and other project files are not exposed as a static folder.

### Backups and deployment

Student pages and uploads are ignored by Git. **Pushing the code is not a backup
of students' work.** Back up both `data/pages/` and `data/uploads/`, or the entire
configured `DATA_DIR`, to another disk or backup service. Webcam photos live
separately under `WEBCAM_DIR`; back up that directory too if you want to retain them. Restore their directory
structure under the same data directory to restore the site. Stop the server while
copying if you need one consistent snapshot.

On deployments, retain the data directory, give the Node service permission to
write to it, and avoid replacing it when updating application code. If the hosting
platform uses temporary disks, mount persistent storage before using this app.

The old project is preserved in
`archive/thinkpad-club-before-reset-2026-10-19.tar.gz`. It includes the previous
working tree, local data, and uncommitted files, excluding `.git` and the archive
folder. Extract it into a separate folder to inspect or restore it. Legacy Pi notes
under `docs/` describe the previous application, including routes that no longer
exist; they are not the current app's instructions.

### Checks

```bash
node --check server.js
node --check public/editor.js
node --test
```

The tests use Node's built-in test runner, temporary data folders, and temporary
localhost ports. They cover page creation, independent page saves, restart
persistence, reset content, image uploads and retrieval, password checks,
cross-origin restrictions, rendering policies, invalid paths, and size limits.
Webcam tests simulate the capture tool to check camera settings, old-photo
retention, photo archiving, timeouts, missing hardware, and simultaneous requests
without accessing a real camera.
They do not modify real student data. Editor handler tests also check save/reset
requests, image-tag insertion, and recovery after a failed save. They use a small
simulated browser environment; real browser layout and code-view DOM parsing are
not covered by browser automation.
