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
from .sap_hana_validators import (
    # Datetime types
    SapDate, SapTime, SapSecondDate, SapTimestamp,
    
    # Numeric types
    SapTinyInt, SapSmallInt, SapInteger, SapBigInt,
    SapSmallDecimal, SapDecimal, SapReal, SapDouble,
    
    # Boolean type
    SapBoolean,
    
    # Character string types
    SapVarchar, SapNvarchar, SapAlphanum, SapShortText,
    
    # Binary types
    SapVarbinary,
    
    # Large Object types
    SapBlob, SapClob, SapNclob, SapText,
    
    # Multi-valued types
    SapArray,
    
    # Spatial types
    SapStGeometry, SapStPoint,
    
    # Comprehensive validator
    SapHanaValue,
    
    # Utility functions
    validate_sap_hana_value, validate_sap_hana_value_comprehensive, get_sap_hana_validator, get_sap_hana_annotated_type,
)
from .sap_pydantic_model import (
    SapHanaBaseModel,
    create_sap_hana_model_class,
)

__version__ = "0.1.0"
__author__ = "514 Labs"
__email__ = "info@514labs.com"
__description__ = "A collection of extra utilities and extensions for the Moose library"

__all__ = [
    # SAP HANA Introspection
    "FieldMetadata",
    "TableMetadata", 
    "HanaIntrospector",
    "introspect_hana_database",
    
    # Moose Model Generator
    "MooseModelConfig",
    "MooseModelGenerator",
    "generate_moose_models",
    
    # SAP HANA Validators - Datetime types
    "SapDate", "SapTime", "SapSecondDate", "SapTimestamp",
    
    # SAP HANA Validators - Numeric types
    "SapTinyInt", "SapSmallInt", "SapInteger", "SapBigInt",
    "SapSmallDecimal", "SapDecimal", "SapReal", "SapDouble",
    
    # SAP HANA Validators - Boolean type
    "SapBoolean",
    
    # SAP HANA Validators - Character string types
    "SapVarchar", "SapNvarchar", "SapAlphanum", "SapShortText",
    
    # SAP HANA Validators - Binary types
    "SapVarbinary",
    
    # SAP HANA Validators - Large Object types
    "SapBlob", "SapClob", "SapNclob", "SapText",
    
    # SAP HANA Validators - Multi-valued types
    "SapArray",
    
    # SAP HANA Validators - Spatial types
    "SapStGeometry", "SapStPoint",
    
    # SAP HANA Validators - Comprehensive validator
    "SapHanaValue",
    
    # SAP HANA Validators - Utility functions
    "validate_sap_hana_value", "validate_sap_hana_value_comprehensive", "get_sap_hana_validator", "get_sap_hana_annotated_type",
    
    # SAP HANA Pydantic Models
    "SapHanaBaseModel", "create_sap_hana_model_class",
]
