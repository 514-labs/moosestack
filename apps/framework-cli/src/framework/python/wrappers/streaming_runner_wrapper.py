import importlib
import os
import signal
import sys
import threading
import time


MODULE_NAME = "moose_lib.streaming.streaming_function_runner"


def _monitor_parent(
    original_parent_pid: int,
    shutdown_flag: threading.Event,
    process_done: threading.Event,
) -> None:
    """Watch for parent process changes and request shutdown when detected."""
    while not shutdown_flag.is_set():
        time.sleep(1)

        current_parent = os.getppid()
        if current_parent == original_parent_pid:
            continue

        try:
            os.kill(original_parent_pid, 0)
        except ProcessLookupError:
            # Original parent already exited
            pass
        except PermissionError:
            # Lost permission to check parent status – assume shutdown required
            pass

        shutdown_flag.set()

        try:
            os.kill(os.getpid(), signal.SIGTERM)
        except OSError:
            return

        # Allow the application a brief window to exit gracefully.
        for _ in range(6):
            if process_done.is_set():
                return
            time.sleep(0.5)

        # Force exit if still running.
        os._exit(0)


def main() -> None:
    # Prepare argv so the downstream module sees the expected CLI arguments.
    module_argv = [MODULE_NAME] + sys.argv[1:]
    sys.argv[:] = module_argv  # type: ignore[call-overload]

    original_parent_pid = os.getppid()
    shutdown_flag = threading.Event()
    process_done = threading.Event()

    monitor_thread = threading.Thread(
        target=_monitor_parent,
        args=(original_parent_pid, shutdown_flag, process_done),
        daemon=True,
    )
    monitor_thread.start()

    try:
        module = importlib.import_module(MODULE_NAME)
        module.main()
    finally:
        shutdown_flag.set()
        process_done.set()


if __name__ == "__main__":
    main()
