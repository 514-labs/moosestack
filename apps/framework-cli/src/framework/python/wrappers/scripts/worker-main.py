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
        while not shutdown_event.is_set():
            time.sleep(1)
            current = os.getppid()
            if current == parent_pid:
                continue

            try:
                os.kill(parent_pid, 0)
            except ProcessLookupError:
                pass
            except PermissionError:
                pass

            shutdown_event.set()

            try:
                os.kill(os.getpid(), signal.SIGTERM)
            except OSError:
                return

            for _ in range(6):
                if not shutdown_event.is_set():
                    return
                time.sleep(0.5)

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
