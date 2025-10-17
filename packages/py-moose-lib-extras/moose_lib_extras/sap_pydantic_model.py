"""
SAP HANA Pydantic Model Base Class.

This module provides a base class for Pydantic models that automatically
handles SAP HANA data types using the appropriate validators.
"""

from typing import Any, Dict, Type, get_origin, get_args
from pydantic import BaseModel, Field, field_validator
import logging

# Try to import get_model_fields from the correct location
try:
    from pydantic._internal._utils import get_model_fields
except ImportError:
    try:
        from pydantic._internal._fields import get_model_fields
    except ImportError:
        # Fallback for newer Pydantic versions
        def get_model_fields(model):
            return model.model_fields

from .sap_hana_validators import get_sap_hana_validator, validate_sap_hana_value

logger = logging.getLogger(__name__)


class SapHanaBaseModel(BaseModel):
    """
    Base class for Pydantic models that handle SAP HANA data types.
    
    This class provides automatic validation and conversion for SAP HANA
    data types based on field annotations or type hints.
    """
    
    class Config:
        # Allow arbitrary types for SAP HANA specific types
        arbitrary_types_allowed = True
        # Use enum values instead of enum names
        use_enum_values = True
        # Validate assignment
        validate_assignment = True
    
    @classmethod
    def __init_subclass__(cls, **kwargs):
        """Initialize subclass and set up SAP HANA field validators."""
        super().__init_subclass__(**kwargs)
        
        # Get model fields
        fields = get_model_fields(cls)
        
        # Add validators for fields with SAP HANA type annotations
        for field_name, field_info in fields.items():
            field_type = field_info.annotation
            
            # Check if field has SAP HANA type annotation
            sap_type = cls._extract_sap_hana_type(field_type)
            if sap_type:
                # Create a field validator for this field
                validator_name = f"validate_{field_name}"
                
                def create_validator(sap_type_name):
                    def validator(cls, value):
                        return validate_sap_hana_value(value, sap_type_name)
                    return validator
                
                # Add the validator to the class
                validator_func = create_validator(sap_type)
                validator_func.__name__ = validator_name
                setattr(cls, validator_name, field_validator(field_name)(validator_func))
    
    @staticmethod
    def _extract_sap_hana_type(field_type: Type) -> str:
        """
        Extract SAP HANA type from field annotation.
        
        Looks for patterns like:
        - SapDate, SapTime, etc. (direct SAP HANA types)
        - Annotated[type, SapValidator] (annotated types)
        """
        # Handle direct SAP HANA types
        if hasattr(field_type, '__name__'):
            type_name = field_type.__name__
            if type_name.startswith('Sap'):
                # Convert SapDate -> DATE, SapTime -> TIME, etc.
                sap_type = type_name[3:].upper()  # Remove 'Sap' prefix
                return sap_type
        
        # Handle Annotated types
        origin = get_origin(field_type)
        if origin is not None:
            args = get_args(field_type)
            if args:
                # Check if any argument is a SAP HANA validator
                for arg in args:
                    if hasattr(arg, '__name__') and arg.__name__.startswith('validate_sap_'):
                        # Extract type from validator name
                        validator_name = arg.__name__
                        sap_type = validator_name.replace('validate_sap_', '').upper()
                        return sap_type
        
        return None
    
    @classmethod
    def from_sap_hana_row(cls, row: Dict[str, Any], field_mapping: Dict[str, str] = None) -> 'SapHanaBaseModel':
        """
        Create model instance from SAP HANA database row.
        
        Args:
            row: Dictionary representing a database row
            field_mapping: Optional mapping from database column names to model field names
            
        Returns:
            Model instance with validated SAP HANA data
        """
        if field_mapping is None:
            field_mapping = {}
        
        # Convert field names using mapping
        converted_data = {}
        for db_field, value in row.items():
            model_field = field_mapping.get(db_field, db_field)
            converted_data[model_field] = value
        
        return cls(**converted_data)
    
    @classmethod
    def get_sap_hana_field_types(cls) -> Dict[str, str]:
        """
        Get mapping of field names to SAP HANA types.
        
        Returns:
            Dictionary mapping field names to SAP HANA type names
        """
        fields = get_model_fields(cls)
        field_types = {}
        
        for field_name, field_info in fields.items():
            field_type = field_info.annotation
            sap_type = cls._extract_sap_hana_type(field_type)
            if sap_type:
                field_types[field_name] = sap_type
        
        return field_types
    
    def to_sap_hana_dict(self) -> Dict[str, Any]:
        """
        Convert model to dictionary suitable for SAP HANA operations.
        
        Returns:
            Dictionary with SAP HANA-compatible values
        """
        return self.model_dump()


# Note: SapHanaField removed due to Pydantic compatibility issues
# Use regular Field() with sap_type in description or metadata instead


# Example usage and type definitions
def create_sap_hana_model_class(table_name: str, fields: Dict[str, str]) -> Type[SapHanaBaseModel]:
    """
    Dynamically create a SAP HANA model class.
    
    Args:
        table_name: Name of the database table
        fields: Dictionary mapping field names to SAP HANA types
        
    Returns:
        Dynamically created model class
    """
    # Create field annotations
    annotations = {}
    field_defaults = {}
    
    for field_name, sap_type in fields.items():
        # Get the appropriate annotated type
        from .sap_hana_validators import get_sap_hana_annotated_type
        annotated_type = get_sap_hana_annotated_type(sap_type)
        
        if annotated_type:
            annotations[field_name] = annotated_type
        else:
            # Fallback to string if no specific type found
            annotations[field_name] = str
            logger.warning(f"No annotated type found for SAP HANA type: {sap_type}")
    
    # Create the class dynamically
    class_name = f"{table_name.title()}Model"
    model_class = type(class_name, (SapHanaBaseModel,), {
        '__annotations__': annotations,
        **field_defaults
    })
    
    return model_class