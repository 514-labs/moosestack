from moose_lib_extras.moose_client import MooseClient


class MooseBatchedModelWriter:
    def __init__(self, moose_client: MooseClient):
        self.moose_client = moose_client
        self.batched_records = {}
    
    def add(self, model_name: str, record: dict):
        if model_name not in self.batched_records:
            self.batched_records[model_name] = []
        self.batched_records[model_name].append(record)
    
    def flush(self):
        """ It's faster to flush by model name """
        for model_name, records in self.batched_records.items():
            if records:
                self.moose_client.write(model_name, records)
        self.batched_records = {}