"""
py-moose-lib-extras

A collection of extra utilities and extensions for the Moose library.
"""

from .sap_hana_introspection import (
    FieldMetadata,
    TableMetadata,
    HanaIntrospector,
    introspect_hana_database,
)
from .moose_model_generator import (
    MooseModelConfig,
    MooseModelGenerator,
    generate_moose_models,
)

__version__ = "0.1.0"
__author__ = "Your Name"
__email__ = "your.email@example.com"
__description__ = "A collection of extra utilities and extensions for the Moose library"

__all__ = [
    "FieldMetadata",
    "TableMetadata", 
    "HanaIntrospector",
    "introspect_hana_database",
    "MooseModelConfig",
    "MooseModelGenerator",
    "generate_moose_models",
]
