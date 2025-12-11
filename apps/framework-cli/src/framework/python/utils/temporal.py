from temporalio.client import Client, TLSConfig
from typing import Dict, Any
import os


async def create_temporal_connection(
    temporal_url: str, namespace: str, client_cert: str, client_key: str, api_key: str
) -> Client:
    """
    Create a connection to the Temporal server with appropriate authentication.
    """
    print(f"Using temporal_url: {temporal_url} and namespace: {namespace}")

    client_options: Dict[str, Any] = {
        "target_host": temporal_url,
        "namespace": namespace,
    }

    if client_cert and client_key:
        print(f"Using certs for secure Temporal")
        with open(client_cert, "rb") as f:
            cert = f.read()
        with open(client_key, "rb") as f:
            key = f.read()

        client_options["tls"] = TLSConfig(
            client_cert=cert,
            client_private_key=key,
        )
    elif api_key:
        # Use regional endpoint for API key authentication
        print("Using API key for secure Temporal")
        client_options["target_host"] = "us-west1.gcp.api.temporal.io:7233"
        client_options["api_key"] = api_key
        client_options["tls"] = True

    print(f"Connecting to Temporal at {temporal_url}")
    client = await Client.connect(**client_options)
    print("Connected to Temporal server")
    return client
