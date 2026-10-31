"""No GPIO library or Raspberry Pi required."""
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('motors', os.path.join(os.path.dirname(__file__), '../lib/motors.py'))
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


class ProgramTests(unittest.TestCase):
    def test_worker_protocol_reports_errors_then_accepts_another_program(self):
        html = Path(__file__).resolve().parents[1].joinpath('public/control.html').read_text()
        hard = re.search(r'<textarea[^>]*>([\s\S]*?)</textarea>', html).group(1)
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'gpiozero.py').write_text(
                'class Motor:\n'
                '    def __init__(self, **pins): self.value = 0\n'
                '    def stop(self): self.value = 0\n'
                '    def close(self): self.stop()\n')
            commands = [
                {'id': 1, 'code': 'import os'},
                {'id': 2, 'code': 'left(0.5)\nright(0.5)'},
                {'id': 3, 'code': hard},
                {'id': 4, 'action': 'stop'}]
            environment = dict(os.environ, PYTHONPATH=directory, PYTHONDONTWRITEBYTECODE='1')
            result = subprocess.run([sys.executable, '-u', module.__file__],
                                    input=''.join(json.dumps(command) + '\n' for command in commands),
                                    capture_output=True, text=True, timeout=5, env=environment)
        self.assertEqual(result.returncode, 0, result.stderr)
        replies = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(replies[0], {'ready': True})
        self.assertIn('Line 1:', replies[1]['error'])
        self.assertEqual(replies[2]['steps'], [
            {'action': 'left', 'speed': .5}, {'action': 'right', 'speed': .5}])
        self.assertEqual(replies[3]['steps'][0], {'action': 'wheels', 'speed': [-.5, -.5], 'duration': 250})
        self.assertEqual(replies[4], {'id': 4})

    def test_program_preserves_order_and_speeds(self):
        code = 'left(0.5)\nright(0.4)\nforward(0.6)\nbackward(0.3)\nstop()'
        self.assertEqual(module.parse_program(code), [
            {'action': action, 'speed': speed} for action, speed in
            [('left', .5), ('right', .4), ('forward', .6), ('backward', .3), ('stop', 0)]])
        self.assertEqual(module.parse_program('# turn\nleft(0)'), [{'action': 'left', 'speed': 0}])

    def test_program_rejects_other_python_without_executing_it(self):
        for code in ['import os', '__import__("os").system("true")', 'open("file", "w")',
                     'while True: forward(0.5)', 'forward(speed)',
                     'left.__call__(0.5)', 'left(*(0.5,))', 'left(speed=0.5)',
                     'left(0.5)\nprint("not allowed")']:
            with self.subTest(code=code), self.assertRaisesRegex(ValueError, 'Line'):
                module.parse_program(code)

    def test_hard_default_records_raw_wheel_values_with_correct_right_polarity(self):
        html = Path(__file__).resolve().parents[1].joinpath('public/control.html').read_text()
        code = re.search(r'<textarea[^>]*>([\s\S]*?)</textarea>', html).group(1)
        with patch.dict(os.environ, {'ROBOT_INVERT_RIGHT': '1'}):
            steps = module.parse_program(code)
        self.assertEqual([step['speed'] for step in steps], [
            [-.5, -.5], [-.5, -.5], [.5, .5], [.5, .5],
            [.5, -.5], [.5, -.5], [-.5, .5], [-.5, .5]])
        self.assertTrue(all(step['action'] == 'wheels' and step['duration'] == 250 for step in steps))
        self.assertEqual(sum(step['duration'] for step in steps), 2000)

    def test_variables_functions_arithmetic_conditions_and_bounded_loops(self):
        code = '''power = 0.2 + 0.3
def turn(speed):
    if speed > 0:
        left(speed)
for count in range(3):
    turn(power)
'''
        self.assertEqual(module.parse_program(code), [{'action': 'left', 'speed': .5}] * 3)

    def test_motor_methods_and_sleep_use_the_declared_pin_orientation(self):
        code = '''from gpiozero import Motor
from time import sleep
wheel = Motor(forward=27, backward=17)
wheel.forward(0.4)
sleep(0.25)
wheel.backward(0.2)
sleep(0.1)
wheel.stop()
sleep(0.1)
wheel.close()
'''
        self.assertEqual(module.parse_program(code), [
            {'action': 'wheels', 'speed': [-.4, 0], 'duration': 250},
            {'action': 'wheels', 'speed': [.2, 0], 'duration': 100},
            {'action': 'wheels', 'speed': [0, 0], 'duration': 100}])

    def test_hard_program_rejects_unbounded_work_system_access_and_invalid_pins(self):
        for code in [
            'from os import system\nsystem(1)',
            'from gpiozero import Motor\nm = Motor(forward=14, backward=15)',
            'from time import sleep\nsleep(11)',
            'from time import sleep\nsleep(-1)',
            'from time import sleep\nfor i in range(20): sleep(1)',
            'def repeat():\n    repeat()\nrepeat()',
            'for a in range(20):\n    for b in range(20):\n        for c in range(20):\n            power = 0.5',
            'from gpiozero import Motor\nm = Motor(forward=17, backward=27)\nm.value = 0.7',
            'from gpiozero import Motor\nm = Motor(forward=17, backward=27)\nm.__class__',
            'from gpiozero import Motor\nm = Motor(forward=17, backward=27)\nm.close()\nm.value = 0.2',
            'forward(' + '9' * 1000 + ')'
        ]:
            with self.subTest(code=code), self.assertRaises(ValueError):
                module.parse_program(code)

    def test_program_limits_and_syntax_errors(self):
        for code in ['', '# only a comment', 'left(0.5)\n' * 21, '#' * 4097,
                     None, 'forward(True)', 'forward(0.7)', 'forward(-0.1)',
                     'forward(1e999)', 'forward()', 'forward(0.2, 0.3)', 'stop(0.5)']:
            with self.subTest(code=code), self.assertRaises(ValueError):
                module.parse_program(code)
        with self.assertRaisesRegex(ValueError, 'Line 2:'):
            module.parse_program('left(0.5)\nright(')


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
                                 ('left', (-.3, .3)), ('right', (.3, -.3))]:
            self.motors.drive(action, .3, time.time() + .5)
            self.assertEqual((self.motors.left.value, self.motors.right.value), expected)
        self.motors.stop()
        self.assertEqual((self.motors.left.value, self.motors.right.value), (0, 0))

    def test_independent_watchdog_and_expired_commands(self):
        self.motors.drive('forward', .3, time.time() + .5)
        time.sleep(.56)
        self.assertEqual((self.motors.left.value, self.motors.right.value), (0, 0))
        with self.assertRaises(ValueError):
            self.motors.drive('forward', .3, time.time() - 1)
        self.assertEqual(self.motors.deadline, 0)

    def test_errors_stop_and_shutdown_closes_both(self):
        for speed in [-1, .61, float('nan'), True, '0.3']:
            self.motors.drive('forward', .3, time.time() + .5)
            with self.assertRaises(ValueError):
                self.motors.drive('forward', speed, time.time() + .5)
            self.assertEqual((self.motors.left.value, self.motors.right.value), (0, 0))
        self.motors.close()
        self.assertTrue(self.motors.left.closed and self.motors.right.closed)

    def test_polarity(self):
        with patch.dict(os.environ, {'ROBOT_INVERT_LEFT': '1'}):
            other = module.Motors(FakeMotor)
        try:
            other.drive('forward', .4, time.time() + .5)
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
            self.motors.drive('forward', .3, time.time() + .5)
        self.assertEqual((self.motors.left.value, self.motors.right.value), (0, 0))

    def test_raw_wheel_steps_do_not_apply_the_right_inversion_twice(self):
        self.motors.signs = [1, -1]
        self.motors.drive('wheels', [.5, -.5], time.time() + .5)
        self.assertEqual((self.motors.left.value, self.motors.right.value), (.5, -.5))
        for speeds in [[.7, 0], [0, float('nan')], [0], .5, [True, 0]]:
            with self.subTest(speeds=speeds), self.assertRaises(ValueError):
                self.motors.drive('wheels', speeds, time.time() + .5)
            self.assertEqual((self.motors.left.value, self.motors.right.value), (0, 0))


if __name__ == '__main__':
    unittest.main()
