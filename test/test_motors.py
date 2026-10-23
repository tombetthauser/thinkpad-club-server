"""No GPIO library or Raspberry Pi required."""
import importlib.util
import os
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('motors', os.path.join(os.path.dirname(__file__), '../robot/motors.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeMotor:
    def __init__(self, **pins):
        self.pins = pins
        self.value = 0
        self.closed = False

    def stop(self):
        self.value = 0

    def close(self):
        self.closed = True


class MotorTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.motors = module.Motors(FakeMotor)

    def tearDown(self):
        self.motors.close()
        self.environment.stop()

    def test_wiring_and_directions(self):
        self.assertEqual(self.motors.left.pins, {'forward': 17, 'backward': 27})
        self.assertEqual(self.motors.right.pins, {'forward': 22, 'backward': 23})
        for action, expected in [('forward', (.3, .3)), ('backward', (-.3, -.3)),
                                 ('left', (-.3, .3)), ('right', (.3, -.3)),
                                 ('test-left', (.3, 0)), ('test-right', (0, .3))]:
            self.motors.drive(action, .3, time.time() + .5)
            self.assertEqual((self.motors.left.value, self.motors.right.value), expected)
        self.motors.stop()
        self.assertEqual((self.motors.left.value, self.motors.right.value), (0, 0))

    def test_independent_watchdog_and_expired_commands(self):
        self.motors.forward(.3)
        time.sleep(.56)
        self.assertEqual((self.motors.left.value, self.motors.right.value), (0, 0))
        with self.assertRaises(ValueError):
            self.motors.drive('forward', .3, time.time() - 1)
        self.assertEqual(self.motors.deadline, 0)

    def test_errors_stop_and_shutdown_closes_both(self):
        for speed in [-1, .61, float('nan'), True, '0.3']:
            self.motors.forward(.3)
            with self.assertRaises(ValueError):
                self.motors.forward(speed)
            self.assertEqual((self.motors.left.value, self.motors.right.value), (0, 0))
        self.motors.close()
        self.assertTrue(self.motors.left.closed and self.motors.right.closed)

    def test_polarity(self):
        with patch.dict(os.environ, {'ROBOT_INVERT_LEFT': '1'}):
            other = module.Motors(FakeMotor)
        try:
            other.forward(.4)
            self.assertEqual((other.left.value, other.right.value), (-.4, .4))
        finally:
            other.close()

    def test_second_motor_initialization_failure_closes_first(self):
        created = []
        def factory(**pins):
            if created:
                raise RuntimeError('GPIO unavailable')
            created.append(FakeMotor(**pins))
            return created[0]
        with self.assertRaises(RuntimeError):
            module.Motors(factory)
        self.assertTrue(created[0].closed)

    def test_output_failure_stops_both(self):
        class BrokenMotor(FakeMotor):
            @property
            def value(self):
                return self._value

            @value.setter
            def value(self, value):
                if value:
                    raise RuntimeError('GPIO write failed')
                self._value = value
        self.motors.right = BrokenMotor()
        with self.assertRaises(RuntimeError):
            self.motors.forward(.3)
        self.assertEqual((self.motors.left.value, self.motors.right.value), (0, 0))


if __name__ == '__main__':
    unittest.main()
