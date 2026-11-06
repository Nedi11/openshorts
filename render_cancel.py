"""Cancellation scoped to one queued edit and its executor subprocesses."""
import contextvars
import os
import signal
import subprocess
import threading

current = contextvars.ContextVar('render_cancel', default=None)

class RenderCancelled(Exception):
    pass

class Token:
    def __init__(self):
        self.cancelled = False
        self.lock = threading.Lock()
        self.processes = set()

    def check(self):
        if self.cancelled:
            raise RenderCancelled('Render cancelled')

    def cancel(self):
        with self.lock:
            self.cancelled = True
            for process in self.processes:
                if process.poll() is None:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass

_OriginalPopen = subprocess.Popen
class ScopedPopen(_OriginalPopen):
    def __init__(self, *args, **kwargs):
        token = current.get()
        if token is None:
            super().__init__(*args, **kwargs)
            return
        with token.lock:
            token.check()
            kwargs['start_new_session'] = True
            super().__init__(*args, **kwargs)
            token.processes.add(self)

# Calls outside a tracked executor retain subprocess's original behavior.
subprocess.Popen = ScopedPopen

async def run_in_executor(loop, executor, function, *args):
    context = contextvars.copy_context()
    token = current.get()
    if token:
        token.check()
    result = await loop.run_in_executor(executor, context.run, function, *args)
    if token:
        token.check()
    return result
