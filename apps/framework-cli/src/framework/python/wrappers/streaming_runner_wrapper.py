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
) -> None:
    """Watch for parent process changes and request shutdown when detected."""
    while not shutdown_flag.is_set():
        time.sleep(1)

        current_parent = os.getppid()
        if current_parent == original_parent_pid:
            continue

        # Parent PID changed - just set shutdown flag and return
        # The main function's finally block will handle cleanup
        shutdown_flag.set()
        break


def main() -> None:
    # Prepare argv so the downstream module sees the expected CLI arguments.
    module_argv = [MODULE_NAME] + sys.argv[1:]
    sys.argv[:] = module_argv  # type: ignore[call-overload]

    original_parent_pid = os.getppid()
    shutdown_flag = threading.Event()

    monitor_thread = threading.Thread(
        target=_monitor_parent,
        args=(original_parent_pid, shutdown_flag),
        daemon=True,
    )
    monitor_thread.start()

    try:
        module = importlib.import_module(MODULE_NAME)
        module.main()
    finally:
        shutdown_flag.set()


if __name__ == "__main__":
    main()
