"""Synthetic-only PTY driver; passwords are supplied via test stdin, never argv."""
import errno
import json
import os
import pty
import select
import signal
import sys
import time

config = json.load(sys.stdin)
child, terminal = pty.fork()
if child == 0:
    os.execvpe(config["command"][0], config["command"], os.environ)
output = bytearray()
step = 0
pending = b""
status = None
deadline = time.monotonic() + 12
try:
    while time.monotonic() < deadline:
        ready, _, _ = select.select([terminal], [], [], 0.05)
        if ready:
            try:
                part = os.read(terminal, 8192)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not part:
                break
            output.extend(part)
            pending += part
        if step < len(config["steps"]):
            match, answer = config["steps"][step]
            if match.encode() in pending:
                os.write(terminal, answer.encode())
                step += 1
                pending = b""
        done, state = os.waitpid(child, os.WNOHANG)
        if done:
            status = state
            break
    if status is None:
        done, state = os.waitpid(child, os.WNOHANG)
        if done:
            status = state
        else:
            os.kill(child, signal.SIGKILL)
            _, status = os.waitpid(child, 0)
finally:
    os.close(terminal)
print(json.dumps({"exitCode": os.waitstatus_to_exitcode(status), "output": output.decode(errors="replace"), "stepsSent": step}))
