import json

from .internal import load_models, to_infra_map, _find_unloaded_files

source_dir = load_models()

# Print in the format expected by the infrastructure system

# Generate the infrastructure map
infra_map_dict = to_infra_map()

# Check for unloaded files
unloaded_files = _find_unloaded_files(source_dir)
infra_map_dict["unloadedFiles"] = unloaded_files
print("___MOOSE_STUFF___start", json.dumps(infra_map_dict), "end___MOOSE_STUFF___")
