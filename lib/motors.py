import ast
import json
import math
import os
import signal
import sys
import threading
import time


def gpio_pins():
    return [int(os.getenv(name, default)) for name, default in [
        ('ROBOT_LEFT_FORWARD', '17'), ('ROBOT_LEFT_BACKWARD', '27'),
        ('ROBOT_RIGHT_FORWARD', '22'), ('ROBOT_RIGHT_BACKWARD', '23')]]


class ProgramMotor:
    def __init__(self, index, sign):
        self.index = index
        self.sign = sign
        self.value = 0
        self.closed = False


class Program:
    def __init__(self):
        self.variables = {}
        self.steps = []
        self.motors = []
        self.operations = 0
        self.depth = 0
        self.seconds = 0

    def number(self, value, limit=1000000):
        if type(value) not in (int, float) or abs(value) > limit or not math.isfinite(value):
            raise ValueError('Use finite numbers within the allowed range.')
        return value

    def record(self, seconds):
        seconds = self.number(seconds, 10)
        if seconds < 0 or self.seconds + seconds > 10:
            raise ValueError('Programs may run for at most 10 seconds.')
        self.seconds += seconds
        values = [0, 0]
        for motor in self.motors:
            values[motor.index] = motor.value * motor.sign
        remaining = round(seconds * 1000)
        while remaining > 0:
            duration = min(250, remaining)
            self.steps.append({'action': 'wheels', 'speed': values.copy(), 'duration': duration})
            remaining -= duration
        if len(self.steps) > 80:
            raise ValueError('Program has too many motor steps.')

    def expression(self, node, scope):
        self.operations += 1
        if self.operations > 2000:
            raise ValueError('Program exceeds the 2000-operation limit.')
        if isinstance(node, ast.Constant):
            if type(node.value) is bool:
                return node.value
            return self.number(node.value)
        if isinstance(node, ast.Name):
            if node.id in scope:
                return scope[node.id]
            if node.id in self.variables:
                return self.variables[node.id]
            raise ValueError(f'Unknown name: {node.id}')
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            value = self.number(self.expression(node.operand, scope))
            return -value if isinstance(node.op, ast.USub) else value
        if isinstance(node, ast.BinOp):
            left = self.number(self.expression(node.left, scope))
            right = self.number(self.expression(node.right, scope))
            if isinstance(node.op, ast.Add):
                result = left + right
            elif isinstance(node.op, ast.Sub):
                result = left - right
            elif isinstance(node.op, ast.Mult):
                result = left * right
            elif isinstance(node.op, ast.Div):
                result = left / right
            else:
                raise ValueError('Use +, -, *, or / for arithmetic.')
            return self.number(result)
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            left = self.number(self.expression(node.left, scope))
            right = self.number(self.expression(node.comparators[0], scope))
            comparisons = {ast.Lt: left < right, ast.LtE: left <= right,
                           ast.Gt: left > right, ast.GtE: left >= right,
                           ast.Eq: left == right, ast.NotEq: left != right}
            if type(node.ops[0]) in comparisons:
                return comparisons[type(node.ops[0])]
        if isinstance(node, ast.Attribute) and node.attr == 'value':
            motor = self.expression(node.value, scope)
            if isinstance(motor, ProgramMotor):
                return motor.value
        if isinstance(node, ast.Call):
            return self.call(node, scope)
        raise ValueError('Unsupported Python expression.')

    def call(self, node, scope):
        args = [self.expression(arg, scope) for arg in node.args]
        keywords = {item.arg: self.expression(item.value, scope) for item in node.keywords}
        if isinstance(node.func, ast.Attribute):
            motor = self.expression(node.func.value, scope)
            if not isinstance(motor, ProgramMotor) or keywords:
                raise ValueError('Only motor methods are supported.')
            if node.func.attr in ('stop', 'close') and not args:
                motor.value = 0
                motor.closed = node.func.attr == 'close' or motor.closed
                return
            if node.func.attr in ('forward', 'backward') and len(args) <= 1 and not motor.closed:
                speed = self.number(args[0] if args else .6, .6)
                if speed < 0:
                    raise ValueError('Motor speed must be between 0 and 0.6.')
                motor.value = speed if node.func.attr == 'forward' else -speed
                return
            raise ValueError('Use motor.value, motor.stop(), or motor.close().')
        if not isinstance(node.func, ast.Name):
            raise ValueError('Unsupported function call.')
        name = node.func.id
        function = scope.get(name, self.variables.get(name))
        if isinstance(function, ast.FunctionDef):
            names = [arg.arg for arg in function.args.args]
            if len(args) > len(names) or any(key not in names for key in keywords):
                raise ValueError(f'Check the arguments to {name}().')
            local = dict(zip(names, args))
            if any(key in local for key in keywords):
                raise ValueError('An argument was supplied twice.')
            local.update(keywords)
            if set(local) != set(names):
                raise ValueError(f'Check the arguments to {name}().')
            self.depth += 1
            if self.depth > 10:
                raise ValueError('Too many nested function calls.')
            try:
                self.block(function.body, local)
            finally:
                self.depth -= 1
            return
        if name == 'Motor' and function == 'Motor':
            if args or set(keywords) != {'forward', 'backward'}:
                raise ValueError('Use Motor(forward=PIN, backward=PIN).')
            pair = (keywords['forward'], keywords['backward'])
            pins = gpio_pins()
            for index, expected in enumerate((tuple(pins[:2]), tuple(pins[2:]))):
                if pair in (expected, expected[::-1]):
                    if any(motor.index == index for motor in self.motors):
                        raise ValueError('Each motor may be created only once.')
                    motor = ProgramMotor(index, 1 if pair == expected else -1)
                    self.motors.append(motor)
                    return motor
            raise ValueError('Motor pins must match the configured left or right motor pair.')
        if keywords:
            raise ValueError('Unsupported keyword arguments.')
        if name == 'sleep' and function == 'sleep' and len(args) == 1:
            self.record(args[0])
            return
        if name == 'range' and len(args) == 1 and type(args[0]) is int and 0 <= args[0] <= 20:
            return range(args[0])
        if name in ('left', 'right', 'forward', 'backward', 'stop') and function is None:
            if name == 'stop' and not args:
                self.steps.append({'action': 'stop', 'speed': 0})
            elif name != 'stop' and len(args) == 1 and 0 <= self.number(args[0], .6) <= .6:
                self.steps.append({'action': name, 'speed': args[0]})
            else:
                raise ValueError('Use a speed from 0 to 0.6, or stop() with no arguments.')
            self.seconds += .5
            if self.seconds > 10 or len(self.steps) > 80:
                raise ValueError('Programs may run for at most 10 seconds.')
            return
        raise ValueError(f'Unsupported function: {name}')

    def block(self, statements, scope):
        for node in statements:
            try:
                self.operations += 1
                if self.operations > 2000:
                    raise ValueError('Program exceeds the 2000-operation limit.')
                if isinstance(node, ast.ImportFrom):
                    allowed = {'gpiozero': 'Motor', 'time': 'sleep'}
                    if node.level or node.module not in allowed or len(node.names) != 1:
                        raise ValueError('Only from gpiozero import Motor and from time import sleep are supported.')
                    item = node.names[0]
                    if item.name != allowed[node.module] or item.asname:
                        raise ValueError('Unsupported import.')
                    scope[item.name] = item.name
                elif isinstance(node, ast.FunctionDef):
                    args = node.args
                    if (node.decorator_list or node.returns or args.defaults or args.kw_defaults
                            or args.posonlyargs or args.kwonlyargs or args.vararg or args.kwarg
                            or any(arg.annotation for arg in args.args)):
                        raise ValueError('Use plain function definitions with named arguments.')
                    scope[node.name] = node
                elif isinstance(node, ast.Assign) and len(node.targets) == 1:
                    target = node.targets[0]
                    value = self.expression(node.value, scope)
                    if isinstance(target, ast.Name):
                        scope[target.id] = value
                    elif isinstance(target, ast.Attribute) and target.attr == 'value':
                        motor = self.expression(target.value, scope)
                        if not isinstance(motor, ProgramMotor) or motor.closed:
                            raise ValueError('Assign value only on an open motor.')
                        motor.value = self.number(value, .6)
                    else:
                        raise ValueError('Unsupported assignment.')
                elif isinstance(node, ast.Expr):
                    self.expression(node.value, scope)
                elif isinstance(node, ast.Try) and not node.handlers:
                    try:
                        self.block(node.body, scope)
                        self.block(node.orelse, scope)
                    finally:
                        self.block(node.finalbody, scope)
                elif isinstance(node, ast.For) and isinstance(node.target, ast.Name) and not node.orelse:
                    values = self.expression(node.iter, scope)
                    if not isinstance(values, range):
                        raise ValueError('Use for ... in range(number), up to 20 repetitions.')
                    for value in values:
                        scope[node.target.id] = value
                        self.block(node.body, scope)
                elif isinstance(node, ast.If):
                    condition = self.expression(node.test, scope)
                    if type(condition) not in (int, float, bool):
                        raise ValueError('Use a numeric condition.')
                    self.block(node.body if condition else node.orelse, scope)
                elif isinstance(node, ast.Pass):
                    pass
                else:
                    raise ValueError('Unsupported Python statement.')
            except (ValueError, TypeError, ZeroDivisionError) as error:
                if str(error).startswith('Line '):
                    raise
                raise ValueError(f'Line {node.lineno}: {error}') from error


def parse_program(code):
    if not isinstance(code, str) or not code.strip() or len(code.encode('utf-8')) > 4096:
        raise ValueError('Write a program of up to 4096 bytes.')
    try:
        statements = ast.parse(code).body
    except SyntaxError as error:
        raise ValueError(f'Line {error.lineno}: {error.msg}') from error
    program = Program()
    program.block(statements, program.variables)
    if not program.steps:
        raise ValueError('Add a motor command, or set motor values and call sleep(seconds).')
    return program.steps


class Motors:
    def __init__(self, factory=None):
        if factory is None:
            from gpiozero import Motor
            factory = Motor
        pins = gpio_pins()
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
                              'left': (-1, 1), 'right': (1, -1)}
                if action == 'wheels':
                    if (not isinstance(speed, list) or len(speed) != 2 or
                            any(type(value) not in (int, float) or not math.isfinite(value) or abs(value) > .6 for value in speed)):
                        raise ValueError('Wheel speeds must be between -0.6 and 0.6.')
                    values = speed
                else:
                    if type(speed) not in (int, float) or not math.isfinite(speed) or not 0 <= speed <= .6:
                        raise ValueError('Speed must be between 0 and 0.6')
                    values = [value * sign * speed for value, sign in zip(directions[action], self.signs)]
                remaining = min(.5, expires - time.time())
                if not math.isfinite(remaining) or remaining <= 0:
                    raise ValueError('Command expired')
                self.stop()
                self.deadline = time.monotonic() + remaining
                for motor, value in zip((self.left, self.right), values):
                    motor.value = value
            except BaseException:
                self.stop()
                raise

    def _watch(self):
        while not self.done.wait(.01):
            with self.lock:
                if self.deadline and time.monotonic() >= self.deadline:
                    try:
                        self.stop()
                    except BaseException:
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
            if 'code' in command:
                try:
                    response = {'id': command['id'], 'steps': parse_program(command['code'])}
                except (ValueError, RecursionError) as error:
                    response = {'id': command['id'], 'error': str(error)}
                print(json.dumps(response), flush=True)
                continue
            motors.drive(command['action'], command.get('speed', 0), command.get('expires', 0))
            print(json.dumps({'id': command['id']}), flush=True)
    finally:
        motors.close()


if __name__ == '__main__':
    main()
