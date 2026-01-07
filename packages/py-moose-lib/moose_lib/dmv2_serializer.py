import json

from .internal import load_models, serialize_infrastructure

load_models()

# Print in the format expected by the infrastructure system
infra_map_dict = serialize_infrastructure()
print("___MOOSE_STUFF___start", json.dumps(infra_map_dict), "end___MOOSE_STUFF___")
