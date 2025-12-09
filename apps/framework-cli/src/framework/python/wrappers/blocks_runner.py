import asyncio
from dataclasses import dataclass
from clickhouse_connect import get_client
from importlib import import_module
import argparse
import os
import sys
import signal
from moose_lib import cli_log, CliLogData


parser = argparse.ArgumentParser(description="Run blocks")
parser.add_argument("blocks_dir_path", type=str, help="Path to the blocks directory")
parser.add_argument("clickhouse_db", type=str, help="Clickhouse database name")
parser.add_argument("clickhouse_host", type=str, help="Clickhouse host")
parser.add_argument("clickhouse_port", type=int, help="Clickhouse port")
parser.add_argument("clickhouse_username", type=str, help="Clickhouse username")
parser.add_argument("clickhouse_password", type=str, help="Clickhouse password")
parser.add_argument("clickhouse_use_ssl", type=str, help="Clickhouse use SSL")


args = parser.parse_args()

interface = "http" if args.clickhouse_use_ssl == "false" else "https"
host = args.clickhouse_host
port = args.clickhouse_port
db = args.clickhouse_db
user = args.clickhouse_username
password = args.clickhouse_password
blocks_dir_path = args.blocks_dir_path

sys.path.append(blocks_dir_path)


# TODO: Handle retries
class DependencyError(Exception):
    pass


def get_file_name(path):
    return os.path.splitext(os.path.basename(path))[0]


def get_blocks_from_file(path):
    # Make sure file path is in sys.path
    block = import_module(get_file_name(path), package=blocks_dir_path)

    # Find the Blocks definition in the module
    blocks_def = block.Blocks

    # Find the Blocks objects in the module
    blocks_objs = [
        obj for obj in dir(block) if isinstance(getattr(block, obj), blocks_def)
    ]

    # Make sure there is exactly one Blocks object in the modules
    if len(blocks_objs) == 0:
        raise ValueError(f"No Blocks object found in {path}")

    if len(blocks_objs) > 1:
        raise ValueError(f"Multiple Blocks objects found in {path}")

    return getattr(block, blocks_objs[0])


def walk_dir(dir, file_extension):
    file_list = []

    for root, dirs, files in os.walk(dir):
        for file in files:
            if file.endswith(file_extension) and file != "__init__.py":
                file_list.append(os.path.join(root, file))

    return file_list


def create_blocks(ch_client, path):
    blocks_obj = get_blocks_from_file(path)

    for query in blocks_obj.setup:
        try:
            print(f"Creating block using query {query}")
            # Merge with any existing client settings to preserve defaults like date_time_input_format
            default_settings = getattr(ch_client, "default_settings", {})
            ch_client.command(
                query, settings={**default_settings, "wait_end_of_query": 1}
            )  # Ensure at least once delivery and DDL acknowledgment
        except Exception as err:
            cli_log(
                CliLogData(
                    action="Blocks",
                    message=f"Failed to create blocks: {err}",
                    message_type="Error",
                )
            )


def delete_blocks(ch_client, path):
    blocks_obj = get_blocks_from_file(path)

    for query in blocks_obj.teardown:
        try:
            print(f"Deleting block using query {query}")
            # Merge with any existing client settings to preserve defaults like date_time_input_format
            default_settings = getattr(ch_client, "default_settings", {})
            ch_client.command(
                query, settings={**default_settings, "wait_end_of_query": 1}
            )  # Ensure at least once delivery and DDL acknowledgment
        except Exception as err:
            cli_log(
                CliLogData(
                    action="Blocks",
                    message=f"Failed to delete blocks: {err}",
                    message_type="Error",
                )
            )


async def async_worker(task):
    delete_blocks(task["ch_client"], task["path"])
    create_blocks(task["ch_client"], task["path"])


async def main():
    print(f"Connecting to Clickhouse at {interface}://{host}:{port}")

    loop = asyncio.get_running_loop()

    # Define your signal handler
    def handle_signal(signame):
        print(f"Received signal {signame}, shutting down.")
        for task in asyncio.all_tasks():
            task.cancel()

    # Add signal handlers
    for signame in ("SIGTERM", "SIGQUIT", "SIGHUP"):
        loop.add_signal_handler(
            getattr(signal, signame), lambda: handle_signal(signame)
        )

    ch_client = get_client(
        interface=interface,
        host=host,
        port=port,
        database=db,
        username=user,
        password=password,
    )
    py_files = walk_dir(blocks_dir_path, ".py")

    block_files = []

    for file in py_files:
        try:
            get_blocks_from_file(file)
            block_files.append(file)
        except Exception as err:
            cli_log(
                CliLogData(
                    action="Blocks",
                    message=f"Failed to import blocks from {file}: {err}",
                    message_type="Error",
                )
            )

    print(f"Found {len(block_files)} blocks in {blocks_dir_path}")
    print(f"Blocks: {block_files}")

    task_defs = [
        {"ch_client": ch_client, "path": path, "retries": len(block_files)}
        for path in block_files
    ]

    print(f"Creating {len(task_defs)} tasks...")
    print(f"Tasks: {task_defs}")

    tasks = list(map(lambda x: asyncio.create_task(async_worker(x)), task_defs))

    print(f"Running {len(tasks)} tasks...")
    print(f"Tasks: {tasks}")

    while not all([task.done() for task in tasks]):
        await asyncio.sleep(1)


asyncio.run(main())
