from python_worker_wrapper import start_worker, log

import sys
import asyncio
import os
import signal
import threading
import time


def main():
    log.info("Starting worker")
    temporal_url = sys.argv[1]
    namespace = sys.argv[2]
    client_cert = sys.argv[3]
    client_key = sys.argv[4]
    api_key = sys.argv[5]

    parent_pid = os.getppid()
    shutdown_event = threading.Event()

    def monitor_parent():
        """Monitor parent process and initiate shutdown if it dies."""
        while not shutdown_event.is_set():
            time.sleep(1)
            current = os.getppid()
            if current == parent_pid:
                continue

            # Parent PID changed - log and exit
            try:
                os.kill(parent_pid, 0)
            except ProcessLookupError:
                log.info("Parent process exited unexpectedly. Terminating worker...")
            except PermissionError:
                log.info("Lost permission to monitor parent process. Terminating worker...")
            else:
                # Parent PID changed but old parent still exists (rare)
                log.info("Parent process changed. Terminating worker to prevent orphan...")

            shutdown_event.set()

            # Give main thread brief moment to exit gracefully
            time.sleep(2)

            # Force exit if still running
            os._exit(0)

    threading.Thread(target=monitor_parent, daemon=True).start()

    try:
        asyncio.run(start_worker(temporal_url, namespace, client_cert, client_key, api_key))
    except KeyboardInterrupt:
        pass
    finally:
        shutdown_event.set()

if __name__ == "__main__":
    main()
