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

1. Choose a name, such as `dannys-page` or `robot-club`.
2. Type the address into your browser. On a local computer, try
   **http://127.0.0.1:3000/dannys-page**. On the live club server, the same page would
   be **https://thinkpad.club/dannys-page**.
3. If the page does not exist yet, you will see a starter page saying hello.
4. Open **Edit this page** below the page.
5. Change some words in the code box.
6. Click **Update**. If there is a class password box, enter the password your
   teacher gave you first.
7. Come back to the same address later to see your saved page.

Use lowercase letters, numbers, and hyphens for page names, up to 64 characters.
Start and end with a letter or number. For example, use `dannys-page`, not
`Danny's Page`. Names are shared: if someone already saved that address, you will
see their page. Ask before changing somebody else's work.

Just visiting an address does **not** save a page. Its first Update creates it.

### What do the code words mean?

**HTML** tells the browser what belongs on a page:

```html
<h1>My robot club</h1>

<p>We build robots and learn together.</p>

<ul>
  <li>Draw an idea</li>
  <li>Build it</li>
  <li>Try it out</li>
</ul>
```

- `<h1>` makes a big heading.
- `<p>` makes a paragraph.
- `<ul>` makes a bullet list; each `<li>` is one item.
- `<a href="/robot-club">Visit our club</a>` makes a link to another page.

**CSS** changes how things look. It goes inside the `<style>` area:

```html
<style>
  h1 {
    color: blue;
  }

  body {
    background-color: lightyellow;
  }
</style>
```

Try changing `blue` to `purple`, then click Update.

### What do the buttons do?

| Control | What it does |
| --- | --- |
| **Update** | Saves this page on the server and reloads it. Your editor stays open. |
| **Reset** | Immediately replaces this page with its starter page and saves it. It does not reset anyone else's page. |
| **Show all code** | Switches between the simple styles-and-body view and the full HTML document. Switching keeps your edits but does not save them. |
| **Add a paragraph / title / list / link** | Adds example HTML at the top of the body in your code box. Change the example words, then Update. |
| **Add style** | Adds a short CSS example for a modern look. Change its values to make it your own, then Update. |
| **Add live webcam image** | Adds the club webcam picture and an Update webcam image button to your page. Click Update to save the block. |
| **Upload image** | Uploads a picture and adds its image tag to the top of your code. Update to save the tag on your page. |

The editor is supplied by the server. You do not need to include it in your HTML,
and deleting your page's content will not delete the editor.

### Put a picture on your page

1. Click **Upload image** below the code box.
2. Choose a PNG, JPEG, GIF, or WebP picture no bigger than 5 MB.
3. The site uploads it and adds code like this:

   ```html
   <img src="/uploads/a-generated-name.png" alt="Describe your image">
   ```

4. Replace `Describe your image` with a helpful description, such as
   `Our cardboard robot with blue wheels`. This helps people who cannot see the image.
5. Move the image code somewhere else in the body if you want.
6. Click **Update**.

The uploaded image's code also appears in a separate box so you can copy it.
The picture itself is uploaded right away; the page's image tag is saved when you
click Update. Use the URL the site gives you. Images on other websites are not
loaded in this version.

### Add the club webcam

1. Click **Add live webcam image** below the code box.
2. Click **Update** to save the webcam block on your page.
3. Use the block's **Update webcam image** button to take a fresh photo.

This uses the USB webcam connected to the **club server**, not the camera on your
computer. It shows the latest still photo, not a streaming video. Photos are taken
only when someone clicks the webcam update button; visiting a page does not turn
on the camera. If the server has a class password, open the editor and enter it
before taking a photo.

You can change the heading, description, image size, or button text in your code.
Keep the `data-webcam`, `data-webcam-image`, `data-webcam-update`, and
`data-webcam-status` attributes so the button keeps working. No JavaScript needs
to be added to your page.

All pages use the same club webcam and latest photo. A capture replaces that
shared photo. Other open pages show the new picture when reloaded or when their
webcam update button is clicked. If the camera is unplugged, the button explains
what went wrong and the last successful photo stays available.

### Where does my work go?

Clicking Update is like putting your notebook back on the shelf. The server saves
a file, so your page stays there when you close your browser or restart the server.
Someone using another computer can see it if they connect to the same server.

The code you are still typing is **not saved yet**. Click Update before leaving.
Reset saves right away and replaces what was there; there is no undo history.

Pages are visible to anyone who can reach this server. Use a nickname or a project
name, and keep private information out of your pages and pictures.

## For teachers and developers

### Robot controls

Optional Raspberry Pi motor controls are available at `/robot`. They are disabled
by default and require explicit enablement and a Python GPIO worker. No robot
password is required; anyone who can reach the server can operate the enabled robot.
See [setup, wiring, configuration, and raised-wheel tests](docs/robot-setup.md).
The existing page editor and webcam routes keep their existing access rules.

### How a page is made

The app uses Node's built-in HTTP server and the computer's filesystem.

For `/dannys-page`:

1. The server sends the shared page shell from `public/editor.html`.
2. The editor requests `GET /api/pages/dannys-page`.
3. The server reads `data/pages/dannys-page.html`. If the file does not exist, it
   generates a starter document in memory. No file or page directory is created by a visit.
4. The student's HTML is displayed in a sandboxed iframe above the shared editor.
5. Update sends the HTML to `PUT /api/pages/dannys-page`.
6. The server writes the file, then the browser reloads the saved page.

Every page uses the same editor HTML, JavaScript, and editor CSS. These files are
separate from student content. Editing their shared implementation updates the
controls for every page without rewriting saved pages.

The home page `/` uses the storage name `index`. Until it has a saved override,
it uses `public/index.html`, which retains the homepage from before this change.
`/index` and `/index.html` redirect to `/`. Reset uses a generic starter, including
for the homepage; it does not restore the legacy homepage.

### Files and responsibilities

```text
server.js             HTTP routes, write access, uploads, response policies
lib/pages.js          Page naming, starter documents, file reads and atomic saves
lib/webcam.js         USB webcam capture, latest photo, and photo archive
public/index.html     Default home content, without editor controls
public/editor.html    Shared page preview and editor controls
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
- sessionStorage remembers only whether this page's editor was open and which
  code view was selected when a save reloads the page. Saving still works if
  browser storage is unavailable.
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
served without browser caching. No background capture loop runs.

The shared parent editor handles the webcam button inside the sandboxed student
page. This supplies one predefined interactive behavior without enabling arbitrary
student scripts. Capture requires the same password and origin checks as saving.
The latest photo is readable by anyone who can reach the site, like the other
public images. Webcam photo archives are not served by the app and are not pruned
automatically; back them up or clear old photos as appropriate for the club.

This feature needs the Linux USB webcam setup on the server. It does not use
browser camera permissions and is not a Mac-camera implementation.

### API routes

| Request | Behavior |
| --- | --- |
| `GET /` or `GET /<page-name>` | Shared shell and editor. |
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
  `api`, `assets`, `uploads`, `health`, `webcam`, and `robot` are reserved. Nested page paths, filename
  extensions, and path traversal are rejected. A trailing slash redirects to the
  canonical address.
- The HTML limit is 1 MB; the image limit is 5 MB. Images get generated filenames
  rather than trusting the original name. File signatures select PNG, JPEG, GIF,
  or WebP; this is a format check, not full image decoding or malware scanning.
  SVG and arbitrary file uploads are unsupported.
- Student HTML is displayed inside an iframe sandbox. Preview responses also set
  Content Security Policy to disable JavaScript, inline event handlers, forms,
  external assets, nested frames, and plugins. Inline CSS and same-server or data
  images are allowed. The shared editor runs outside this sandbox, so student CSS
  and scripts cannot remove its controls. This version teaches HTML and CSS, not
  student-authored JavaScript.
- Regular HTTP(S) links are handled by the parent page so visiting another club
  page opens its editor instead of nesting another editor in the preview.
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
