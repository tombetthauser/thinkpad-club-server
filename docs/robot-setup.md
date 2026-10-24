# Robot setup and wheels-raised checks

The existing Node HTTP server starts one Python GPIO worker; there is no second
web server. GPIO control is disabled unless `ROBOT_ENABLED=1` is set.
Visit `/robot` and click **Enable controls**; no password is required.
Anyone who can reach this server can operate the robot when enabled.
Controller identity lives only in browser memory.

## Wiring

Use BCM numbering: GPIO17 (physical 11) → IN1, GPIO27 (13) → IN2,
GPIO22 (15) → IN3, GPIO23 (16) → IN4. OUT1/OUT2 drive the left motor;
OUT3/OUT4 drive the right. Connect Pi ground (physical 6), driver ground,
and battery negative together. Battery positive goes only to driver VCC.
Keep motor battery power separate from Pi USB positive power.
GPIO14/15 remain reserved for future UART use.

The board's EEP/ULT pins and J2 jumper are deliberately untouched. Their behavior
has not been verified for this WWZMDiB board. If motors do not turn, check battery
voltage, wiring, and the actual board's enable/sleep documentation before changing
pins or jumpers. Software cannot establish that the driver is powered or enabled.

## Pi environment

The development checkout was inspected on macOS with Node 24 and Python 3.14;
gpiozero was absent. No Pi connection or physical motor test was performed.
The existing `venv/` is machine-specific; use the Pi's system Python, not a copied
Mac virtual environment. Node 22+ is still required by the existing server.

On Raspberry Pi OS, install GPIO Zero if necessary:

```sh
sudo apt update
sudo apt install python3-gpiozero
/usr/bin/python3 -c 'import gpiozero; print("gpiozero import OK")'
id
ls -l /dev/gpiomem /dev/gpiochip*
```

The service user needs access to the GPIO device (normally Raspberry Pi OS's
`gpio` group). If necessary, `sudo usermod -aG gpio <service-user>`, then restart
that user's session/service. Do not run the entire web server as root. A successful
import alone does not verify GPIO permissions: the worker must reach `ready`.
If the OS does not provide a compatible pin factory, resolve that Pi environment
first; worker startup errors go to the server log and movement stays unavailable.

Start with the wheels raised, battery disconnected while checking wiring, and
the USB cable free of tension. Reconnect motor power only when ready to test.
For a local Pi session:

```sh
ROBOT_ENABLED=1 ROBOT_PYTHON=/usr/bin/python3 node server.js
```

For systemd, put these environment variables in the existing Node service's
protected environment configuration. This work does not modify or deploy that
service. Use a single Node process for this robot; do not run replicas sharing GPIO.
Never run another GPIO test utility while the worker owns the pins.

Use the existing HTTPS reverse proxy and set `PUBLIC_ORIGIN` to the exact browser
origin (no trailing slash) for remote use. Motor routes have no password or account
authorization. The local default
bind address remains `127.0.0.1`; use an SSH tunnel for private access if desired.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `ROBOT_ENABLED` | off | Only `1` opts into GPIO. No password is required. |
| `ROBOT_PYTHON` | `python3` | Python executable with gpiozero and GPIO device access. |
| `ROBOT_LEFT_FORWARD` / `ROBOT_LEFT_BACKWARD` | `17` / `27` | Left motor BCM pins. |
| `ROBOT_RIGHT_FORWARD` / `ROBOT_RIGHT_BACKWARD` | `22` / `23` | Right motor BCM pins. |
| `ROBOT_INVERT_LEFT` / `ROBOT_INVERT_RIGHT` | off | Set either to `1` to reverse that wheel's software polarity. |

The slider selects 0–60% power and starts at 30%. Python also enforces the 60%
ceiling. Restart the service after changing wiring/polarity configuration. Pin
configuration must use four distinct BCM pins in 0–27 excluding UART pins 14/15.

## Minimal manual verification

1. Open `/robot` and click **Enable controls**. A GPIO
   startup failure keeps controls locked; check the server log.
2. Expand calibration. Briefly hold **Test left wheel**, then release. Only the
   left wheel should spin and stop. Repeat for the right. Increase speed gradually
   if 30% does not overcome motor friction, never exceeding 60%.
3. Hold Forward briefly. Determine actual wheel polarity with the chassis raised;
   change `ROBOT_INVERT_LEFT` or `ROBOT_INVERT_RIGHT` and restart as needed. Verify
   Reverse, Left, and Right. Turns counter-rotate the wheels.
4. Verify button release, STOP, Escape, and Space stop movement. Check touch hold
   and release on a mobile browser, and arrow hold/release on desktop. Switching
   tabs or losing window focus also sends stop.
5. While holding a direction, disconnect the browser network or disable JavaScript
   execution in developer tools. Both outputs should stop within 500 ms of the
   last accepted refresh (plus small OS scheduling latency). Closing the tab alone
   exercises browser stop too; blocking the network tests the server watchdog.
6. Enable controls in a second tab. While the first is driving, the second must receive a
   controller conflict for movement. STOP remains available to any
   operator, including while a movement acknowledgement is pending. After release
   or timeout another tab may drive.
7. While holding a direction, stop Node with Ctrl+C or stop its systemd service.
   Both motors must stop. On Node process death, worker stdin EOF also stops it;
   on a Node stall, the independent Python watchdog still expires movement.
8. Check `/health`, page editing, uploads, and webcam capture as usual. Only after
   all raised-wheel tests pass, make very brief floor tests with USB cable slack.
   The Pi remains tethered to wall power; avoid twisting or pulling its cable.

State text reports acknowledged commands, not measured motion. There are no wheel
sensors. No hardware operation, polarity, mobile browser behavior, or floor safety
has been confirmed by the automated tests.

## API and failure behavior

`GET /api/robot/status` returns enabled/ready, command state, `maxSpeed: 0.6`, and
`timeoutMs: 500`. `POST /api/robot/{forward,backward,left,right,stop,test-left,test-right}`
requires JSON (`{"speed":0.3}`, or `{}` for stop) and
`X-Robot-Controller` (a per-tab UUID). Existing cross-origin protections apply;
neither a robot password nor the class password is required for these routes.
Unknown commands, malformed JSON, invalid speeds, missing identity, and
cross-origin requests never drive motors. Rejected requests do not refresh the
watchdog. Non-owner movement returns 409. A controller owns movement until stop
or expiry; requests are serialized, and stop can interrupt the lease from any tab.

Each worker command has an absolute expiry to reject queued stale movement and a
monotonic deadline capped at 500 ms. A dedicated Python thread checks every 10 ms
even while stdin is idle. GPIO exceptions stop both outputs and terminate the
worker. EOF, SIGINT, and SIGTERM stop/close both motors. Node requires worker
acknowledgements within 400 ms; failure closes stdin and terminates the worker.
There is no automatic restart or replay of movement after a worker fault.
Motor stop drives both inputs low (coast); it does not guarantee instant mechanical
braking. OS/Python failure or a stuck GPIO driver cannot be made safe by a software
watchdog alone. Disconnect the motor battery to physically remove motor power.

## Software checks without GPIO

```sh
node --test
python3 -B -m unittest discover -s test -p 'test_*.py'
```

Node tests use simulated worker streams and HTTP requests. Python tests use fake
motors to check directions, polarity, stop, expiry, validation, and cleanup. They
do not energize pins or alter student files.
