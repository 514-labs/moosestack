import argparse
import asyncio
import dataclasses
import json
import os
import subprocess
import sys
import traceback
import signal
import threading
from datetime import datetime, timezone, date, timedelta

from http import HTTPStatus
from http.server import HTTPServer, BaseHTTPRequestHandler

from importlib import import_module
from typing import Optional, Dict, Any
from urllib.parse import urlparse, parse_qs
from moose_lib import MooseClient, Sql
from moose_lib.query_param import map_params_to_class, convert_api_param, convert_pydantic_definition
from moose_lib.internal import load_models
from moose_lib.dmv2 import get_api, get_apis, get_workflow, get_web_apps
from moose_lib.dmv2.web_app_helpers import ApiUtil
from pydantic import BaseModel, ValidationError

import jwt
from clickhouse_connect import get_client

from moose_lib.commons import EnhancedJSONEncoder

from consumption_wrapper.utils import create_temporal_connection

parser = argparse.ArgumentParser(description='Run Consumption Server')
parser.add_argument('consumption_dir_path', type=str,
                    help='Path to the consumption directory')
parser.add_argument('clickhouse_db', type=str, help='Clickhouse database name')
parser.add_argument('clickhouse_host', type=str, help='Clickhouse host')
parser.add_argument('clickhouse_port', type=int, help='Clickhouse port')
parser.add_argument('clickhouse_username', type=str,
                    help='Clickhouse username')
parser.add_argument('clickhouse_password', type=str,
                    help='Clickhouse password')
parser.add_argument('clickhouse_use_ssl', type=str, help='Clickhouse use SSL')
parser.add_argument('jwt_secret', type=str, help='JWT secret')
parser.add_argument('jwt_issuer', type=str, help='JWT issuer')
parser.add_argument('jwt_audience', type=str, help='JWT audience')
parser.add_argument('jwt_enforce_all', type=str, help='Auto-handle requests without JWT')
parser.add_argument('temporal_url', type=str, help='Temporal URL')
parser.add_argument('temporal_namespace', type=str, help='Temporal namespace')
parser.add_argument('client_cert', type=str, help='Client certificate')
parser.add_argument('client_key', type=str, help='Client key')
parser.add_argument('api_key', type=str, help='API key')
parser.add_argument('is_dmv2', type=str, help='Is DMv2')
parser.add_argument('proxy_port', type=int, help='Proxy port')

args = parser.parse_args()

interface = 'http' if args.clickhouse_use_ssl == "false" else 'https'
host = args.clickhouse_host
port = args.clickhouse_port
db = args.clickhouse_db
user = args.clickhouse_username
password = args.clickhouse_password
consumption_dir_path = args.consumption_dir_path

jwt_secret = args.jwt_secret
jwt_issuer = args.jwt_issuer
jwt_audience = args.jwt_audience
jwt_enforce_all = args.jwt_enforce_all

temporal_url = args.temporal_url
temporal_namespace = args.temporal_namespace
client_cert = args.client_cert
client_key = args.client_key
api_key = args.api_key
is_dmv2 = args.is_dmv2.lower() == 'true'

sys.path.append(consumption_dir_path)


def verify_jwt(token: str) -> Optional[Dict[str, Any]]:
    try:
        payload = jwt.decode(token, jwt_secret, algorithms=["RS256"], audience=jwt_audience, issuer=jwt_issuer)
        return payload
    except Exception as e:
        print("JWT verification failed:", str(e))
        return None

def has_jwt_config() -> bool:
    return jwt_secret and jwt_issuer and jwt_audience


async def execute_asgi_app(asgi_app, scope, request_body: bytes):
    """
    Execute an ASGI application (FastAPI) and return the response.

    Args:
        asgi_app: The ASGI application (FastAPI app instance)
        scope: ASGI scope dictionary with request information
        request_body: The request body as bytes

    Returns:
        tuple: (status_code, headers, body)
    """
    response_started = False
    status_code = 200
    response_headers = []
    response_body = []

    async def receive():
        """ASGI receive callable - provides request body."""
        return {
            'type': 'http.request',
            'body': request_body,
            'more_body': False,
        }

    async def send(message):
        """ASGI send callable - captures response."""
        nonlocal response_started, status_code, response_headers, response_body

        if message['type'] == 'http.response.start':
            response_started = True
            status_code = message['status']
            response_headers = message.get('headers', [])
        elif message['type'] == 'http.response.body':
            body = message.get('body', b'')
            if body:
                response_body.append(body)

    try:
        await asgi_app(scope, receive, send)
        return status_code, response_headers, b''.join(response_body)
    except Exception as e:
        print(f"Error executing ASGI app: {e}")
        traceback.print_exc()
        return 500, [], json.dumps({"error": "Internal Server Error"}).encode()


def handler_with_client(moose_client):
    class SimpleHTTPRequestHandler(BaseHTTPRequestHandler):
        def log_request(self, code = "-", size = "-"):
            """instead of calling log_message which goes to stderr by default,
            this implementation goes to stdout, but is otherwise the same.
            """
            if isinstance(code, HTTPStatus):
                code = code.value
            sys.stdout.write('%s - - [%s] "%s" %s %s\n' %
                             (self.address_string(),
                              self.log_date_time_string(),
                              self.requestline,
                              str(code),
                              str(size)))
        def handle_request(self):
            """Unified request handler for all HTTP methods."""
            parsed_path = urlparse(self.path)
            raw_path = parsed_path.path
            method = self.command

            # Read request body for POST/PUT/PATCH methods
            content_length = int(self.headers.get('Content-Length', 0))
            request_body = self.rfile.read(content_length) if content_length > 0 else b''

            try:
                jwt_payload = None
                if has_jwt_config():
                    auth_header = self.headers.get('Authorization')
                    if auth_header:
                        # Bearer <token>
                        token = auth_header.split(" ")[1] if " " in auth_header else None
                        if token:
                            jwt_payload = verify_jwt(token)

                    if jwt_payload is None and jwt_enforce_all == 'true':
                        self.send_response(401)
                        self.end_headers()
                        self.wfile.write(bytes(json.dumps({"error": "Unauthorized"}), 'utf-8'))
                        return

                # Check for WebApp routes first (if dmv2 is enabled)
                if is_dmv2:
                    web_apps = get_web_apps()
                    # Sort by mount path length (longest first) for proper routing
                    sorted_web_apps = sorted(web_apps.values(), key=lambda wa: len(wa.config.mount_path), reverse=True)

                    for web_app in sorted_web_apps:
                        mount_path = web_app.config.mount_path
                        normalized_mount = mount_path.rstrip('/')

                        # Check if path matches this WebApp
                        matches = (
                            raw_path == normalized_mount or
                            raw_path.startswith(normalized_mount + "/")
                        )

                        if matches:
                            # This request is for a WebApp
                            print(f"[WebApp] Routing {method} {raw_path} to WebApp '{web_app.name}'")

                            # Inject Moose utilities into request state if enabled
                            moose_utils = None
                            if web_app.config.inject_moose_utils:
                                moose_utils = ApiUtil(
                                    client=moose_client,
                                    sql=Sql,
                                    jwt=jwt_payload
                                )

                            # Strip mount path from URL for the FastAPI app
                            proxied_path = raw_path
                            proxied_path = raw_path[len(normalized_mount):]

                            # Build ASGI scope
                            server_name = getattr(self.server, 'server_name', 'localhost')
                            server_port = getattr(self.server, 'server_port', 4000)
                            scope = {
                                'type': 'http',
                                'asgi': {'version': '3.0'},
                                'http_version': self.request_version.split('/')[-1],
                                'method': method,
                                'scheme': 'http',
                                'path': proxied_path,
                                'query_string': parsed_path.query.encode() if parsed_path.query else b'',
                                'root_path': '',
                                'headers': [(k.lower().encode(), v.encode()) for k, v in self.headers.items()],
                                'server': (server_name, server_port),
                                'client': self.client_address,
                                'state': {'moose': moose_utils} if moose_utils else {},
                            }

                            # Execute the FastAPI app via ASGI
                            status_code, response_headers, response_body = asyncio.run(
                                execute_asgi_app(web_app.app, scope, request_body)
                            )

                            # Send response
                            self.send_response(status_code)
                            for header_name, header_value in response_headers:
                                self.send_header(header_name.decode(), header_value.decode())
                            self.end_headers()
                            self.wfile.write(response_body)
                            return

                # If no WebApp matched, fall back to Api routing
                query_params = parse_qs(parsed_path.query)

                # Strip /api or /consumption prefix for Api routing
                if raw_path.startswith('/api'):
                    stripped_path = raw_path[len('/api'):]
                elif raw_path.startswith('/consumption'):
                    stripped_path = raw_path[len('/consumption'):]
                else:
                    stripped_path = raw_path

                full_path = stripped_path.lstrip('/').rstrip('/')
                path_parts = full_path.split('/')

                # For backward compatibility, keep the old parsing logic
                module_name = path_parts[0]
                version_from_path = "/".join(path_parts[1:]) if len(path_parts) > 1 else None

                if is_dmv2:
                    # First try to look up by the full path (for custom paths)
                    user_api = get_api(full_path)
                    
                    # If not found by path, fall back to name:version lookup
                    if user_api is None:
                        # Use alias-aware lookup: unversioned name resolves to explicit unversioned
                        # or the sole versioned API if exactly one exists
                        user_api = (
                            get_api(f"{module_name}:{version_from_path}")
                            if version_from_path
                            else get_api(module_name)
                        )
                    
                    if user_api is not None:
                        query_fields = convert_pydantic_definition(user_api.model_type)
                        try:
                            params = map_params_to_class(query_params, query_fields, user_api.model_type)
                        except (ValidationError, ValueError) as e:
                            traceback.print_exc()
                            self.send_response(400)
                            self.end_headers()
                            self.wfile.write(str(e).encode())
                            return
                        args = [moose_client, params]
                        if jwt_payload is not None:
                            args.append(jwt_payload)
                        print(f"[API] | Executing API: {user_api.name}")
                        response = user_api.query_function(*args)
                        # Convert Pydantic model to dict before JSON serialization
                        if isinstance(response, BaseModel):
                            response = response.model_dump_json()
                    else:
                        self.send_response(404)
                        self.end_headers()
                        available_apis = list(get_apis().keys())
                        error_message = f"API {module_name}"
                        if version_from_path:
                            error_message += f" with version {version_from_path}"
                        error_message += f" not found. Available APIs: {', '.join(available_apis).replace(':', '/')}"
                        self.wfile.write(bytes(json.dumps({"error": error_message}), 'utf-8'))
                        return
                else:
                    module = import_module(module_name)
                    fields_and_class = convert_api_param(module)

                    if fields_and_class is not None:
                        (cls, fields) = fields_and_class
                        query_params = map_params_to_class(query_params, fields, cls)

                    args = [moose_client, query_params]
                    if jwt_payload is not None:
                        args.append(jwt_payload)
                    response = module.run(*args)

                if hasattr(response, 'status') and hasattr(response, 'body'):
                    self.send_response(response.status)  # type: ignore[attr-defined]
                    response_message = bytes(json.dumps(response.body, cls=EnhancedJSONEncoder), 'utf-8')  # type: ignore[attr-defined]
                else:
                    self.send_response(200)
                    response_message = bytes(
                        response if isinstance(response, str) else json.dumps(response, cls=EnhancedJSONEncoder),
                        'utf-8')

                self.end_headers()
                self.wfile.write(response_message)

            except Exception as e:
                traceback.print_exc()
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())

        # HTTP method handlers - all delegate to handle_request
        def do_GET(self):
            self.handle_request()

        def do_POST(self):
            self.handle_request()

        def do_PUT(self):
            self.handle_request()

        def do_DELETE(self):
            self.handle_request()

        def do_PATCH(self):
            self.handle_request()

        def do_OPTIONS(self):
            self.handle_request()

        def do_HEAD(self):
            self.handle_request()

    return SimpleHTTPRequestHandler


class DependencyError(Exception):
    pass


def get_file_name(path):
    return os.path.splitext(os.path.basename(path))[0]


def walk_dir(dir, file_extension):
    file_list = []

    for root, dirs, files in os.walk(dir):
        for file in files:
            if file.endswith(file_extension):
                file_list.append(os.path.join(root, file))

    return file_list


def main():
    print(f"Connecting to Clickhouse at {interface}://{host}:{port}")
    ch_client = get_client(interface=interface, host=host,
                           port=port, database=db, username=user, password=password)

    temporal_client = None
    try:
        print("Connecting to Temporal")
        temporal_client = asyncio.run(create_temporal_connection(temporal_url, temporal_namespace, client_cert, client_key, api_key))
    except Exception as e:
        print(f"Failed to connect to Temporal. Is the feature flag enabled? {e}")

    if is_dmv2:
        print("Loading DMv2 models")
        load_models()

    moose_client = MooseClient(ch_client, temporal_client)
    server_port = args.proxy_port
    server_address = ('localhost', server_port)
    handler = handler_with_client(moose_client)
    httpd = HTTPServer(server_address, handler)

    # Store references for cleanup
    httpd.moose_client = moose_client  # type: ignore[attr-defined]
    
    def shutdown_server():
        httpd.shutdown()
        print("\nShutting down server...")
        httpd.server_close()
        # Cleanup clients
        asyncio.run(moose_client.cleanup())
        print("Server shutdown complete")
    
    def signal_handler(signum, frame):
        print(f"\nReceived signal {signum}. Starting graceful shutdown...")
        # Start shutdown in a separate thread to avoid deadlock
        threading.Thread(target=shutdown_server).start()
    
    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGQUIT, signal_handler)
    signal.signal(signal.SIGHUP, signal_handler)
    
    print(f"Starting server on http://localhost:{server_port}")
    
    try:
        httpd.serve_forever()
    except Exception as e:
        print(f"Server error: {e}")


main()
