import requests

class MooseClient:
    def __init__(self, base_url: str, request_timeout: int = 10):
        self.base_url = base_url
        self.request_timeout = request_timeout

    def write(self, model_name: str, records: list[dict]):
        url = f"{self.base_url}/ingest/{model_name}"
        r = requests.post(url, json=records, timeout=self.request_timeout)
        r.raise_for_status()
        return r.json()
