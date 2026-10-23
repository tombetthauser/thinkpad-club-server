"""GPIO owner. JSON lines on stdin/stdout; no network listener."""
import json
import math
import os
import signal
import sys
import threading
import time


class Motors:
    def __init__(self, factory=None):
        if factory is None:
            from gpiozero import Motor
            factory = Motor
        pins = [int(os.getenv(name, default)) for name, default in [
            ('ROBOT_LEFT_FORWARD', '17'), ('ROBOT_LEFT_BACKWARD', '27'),
            ('ROBOT_RIGHT_FORWARD', '22'), ('ROBOT_RIGHT_BACKWARD', '23')]]
        if len(set(pins)) != 4 or any(p < 0 or p > 27 or p in (14, 15) for p in pins):
            raise ValueError('Use four distinct BCM pins, reserving GPIO14/15 for UART')
        self.left = factory(forward=pins[0], backward=pins[1])
        try:
            self.right = factory(forward=pins[2], backward=pins[3])
        except BaseException:
            self.left.close()
            raise
        self.signs = [(-1 if os.getenv(k) == '1' else 1) for k in
                      ('ROBOT_INVERT_LEFT', 'ROBOT_INVERT_RIGHT')]
        self.lock = threading.RLock()
        self.deadline = 0
        self.closed = False
        self.done = threading.Event()
        self.watchdog = threading.Thread(target=self._watch, daemon=True)
        self.watchdog.start()

    def stop(self):
        with self.lock:
            self.deadline = 0
            try:
                self.left.stop()
            finally:
                self.right.stop()

    def drive(self, action, speed, expires):
        with self.lock:
            try:
                if self.closed:
                    raise ValueError('Motor service closed')
                if action == 'stop':
                    self.stop()
                    return
                directions = {'forward': (1, 1), 'backward': (-1, -1),
                              'left': (-1, 1), 'right': (1, -1),
                              'test-left': (1, 0), 'test-right': (0, 1)}
                if isinstance(speed, bool) or not isinstance(speed, (float, int)) or not math.isfinite(speed) or not 0 <= speed <= .6:
                    raise ValueError('Speed must be between 0 and 0.6')
                remaining = min(.5, expires - time.time())
                if not math.isfinite(remaining) or remaining <= 0:
                    raise ValueError('Command expired')
                direction = directions[action]
                self.stop()
                self.deadline = time.monotonic() + remaining
                for motor, sign, value in zip((self.left, self.right), self.signs, direction):
                    motor.value = value * sign * speed
            except BaseException:
                self.stop()
                raise

    def forward(self, speed):
        self.drive('forward', speed, time.time() + .5)

    def backward(self, speed):
        self.drive('backward', speed, time.time() + .5)

    def turn_left(self, speed):
        self.drive('left', speed, time.time() + .5)

    def turn_right(self, speed):
        self.drive('right', speed, time.time() + .5)

    def _watch(self):
        while not self.done.wait(.01):
            with self.lock:
                if self.deadline and time.monotonic() >= self.deadline:
                    try:
                        self.stop()
                    except BaseException:
                        # GPIO failures must take the service out of operation.
                        os._exit(1)

    def close(self):
        with self.lock:
            self.closed = True
            self.done.set()
            try:
                self.stop()
            finally:
                try:
                    self.left.close()
                finally:
                    self.right.close()


def main():
    motors = Motors()
    def shutdown(*_):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        print(json.dumps({'ready': True}), flush=True)
        for line in sys.stdin:
            command = json.loads(line)
            motors.drive(command['action'], command.get('speed', 0), command.get('expires', 0))
            print(json.dumps({'id': command['id']}), flush=True)
    finally:
        motors.close()


if __name__ == '__main__':
    main()
