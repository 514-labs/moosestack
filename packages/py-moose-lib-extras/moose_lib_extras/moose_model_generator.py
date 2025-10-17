"""
Moose model generator for creating Python models and pipelines from database metadata.

This module provides functionality to generate Moose models and pipelines
from TableMetadata objects extracted from database introspection.
"""

from typing import List, Dict, Optional, Set
from dataclasses import dataclass
import logging
from pathlib import Path

from .sap_hana_introspection import TableMetadata, FieldMetadata
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
    
    # Utility functions
    get_sap_hana_annotated_type,
)

logger = logging.getLogger(__name__)


@dataclass
class MooseModelConfig:
    """Configuration for Moose model generation."""
        
    # Model generation options
    include_timestamp_fields: bool = True
    timestamp_field_names: Set[str] = None
    primary_key_field_names: Set[str] = None
    
    # SAP HANA specific options
    use_sap_hana_validators: bool = True
    fallback_to_string_types: bool = True
    include_field_comments: bool = True
    
    # Field nullability options
    force_all_fields_nullable: bool = False
    
    def __post_init__(self):
        if self.timestamp_field_names is None:
            self.timestamp_field_names = {
                'timestamp', 'utc_timestamp', 'created_at', 'updated_at',
                'created_time', 'updated_time', 'ts', 'datetime'
            }
        
        if self.primary_key_field_names is None:
            self.primary_key_field_names = {
                'id', 'primary_key', 'pk', 'key'
            }


class MooseModelGenerator:
    """Generator for Moose models and pipelines from database metadata."""
    
    # Mapping from SAP HANA data types to SAP HANA annotated types
    SAP_HANA_TYPE_MAPPING = {
        # Integer types
        'TINYINT': 'SapTinyInt',
        'SMALLINT': 'SapSmallInt', 
        'INTEGER': 'SapInteger',
        'BIGINT': 'SapBigInt',
        
        # Decimal types
        'SMALLDECIMAL': 'SapSmallDecimal',
        'DECIMAL': 'SapDecimal',
        'NUMERIC': 'SapDecimal',
        'REAL': 'SapReal',
        'FLOAT': 'SapReal',
        'DOUBLE': 'SapDouble',
        
        # String types
        'VARCHAR': 'SapVarchar',
        'NVARCHAR': 'SapNvarchar',
        'CHAR': 'SapVarchar',
        'NCHAR': 'SapNvarchar',
        'ALPHANUM': 'SapAlphanum',
        'SHORTTEXT': 'SapShortText',
        'TEXT': 'SapText',
        'CLOB': 'SapClob',
        'NCLOB': 'SapNclob',
        
        # Date/Time types
        'DATE': 'SapDate',
        'TIME': 'SapTime',
        'TIMESTAMP': 'SapTimestamp',
        'SECONDDATE': 'SapSecondDate',
        
        # Boolean types
        'BOOLEAN': 'SapBoolean',
        
        # Binary types
        'BLOB': 'SapBlob',
        'VARBINARY': 'SapVarbinary',
        'BINARY': 'SapVarbinary',
        
        # Multi-valued types
        'ARRAY': 'SapArray',
        
        # Spatial types
        'ST_GEOMETRY': 'SapStGeometry',
        'ST_POINT': 'SapStPoint',
        
        # JSON types (fallback to dict)
        'JSON': 'dict',
        
        # Default fallback
        'DEFAULT': 'SapVarchar'
    }
    
    # Fallback mapping for when SAP HANA validators are disabled
    FALLBACK_TYPE_MAPPING = {
        # Integer types
        'TINYINT': 'int',
        'SMALLINT': 'int', 
        'INTEGER': 'int',
        'BIGINT': 'int',
        
        # Decimal types
        'SMALLDECIMAL': 'float',
        'DECIMAL': 'float',
        'NUMERIC': 'float',
        'REAL': 'float',
        'FLOAT': 'float',
        'DOUBLE': 'float',
        
        # String types
        'VARCHAR': 'str',
        'NVARCHAR': 'str',
        'CHAR': 'str',
        'NCHAR': 'str',
        'ALPHANUM': 'str',
        'SHORTTEXT': 'str',
        'TEXT': 'str',
        'CLOB': 'str',
        'NCLOB': 'str',
        
        # Date/Time types
        'DATE': 'str',
        'TIME': 'str',
        'TIMESTAMP': 'str',
        'SECONDDATE': 'str',
        
        # Boolean types
        'BOOLEAN': 'bool',
        
        # Binary types
        'BLOB': 'str',
        'VARBINARY': 'str',
        'BINARY': 'str',
        
        # Multi-valued types
        'ARRAY': 'list',
        
        # Spatial types
        'ST_GEOMETRY': 'str',
        'ST_POINT': 'str',
        
        # JSON types
        'JSON': 'dict',
        
        # Default fallback
        'DEFAULT': 'str'
    }
    
    def __init__(self, config: Optional[MooseModelConfig] = None):
        """
        Initialize the Moose model generator.
        
        Args:
            config: Configuration for model generation. If None, uses defaults.
        """
        self.config = config or MooseModelConfig()
    
    def generate_models(self, tables: List[TableMetadata], output_path: str) -> None:
        """
        Generate Moose models and pipelines for a list of tables.
        
        Args:
            tables: List of TableMetadata objects
            output_path: Path to write the generated Python file
        """
        if not tables:
            logger.warning("No tables provided for model generation")
            return
        
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Generate the Python code
        code = self._generate_python_code(tables)
        
        # Write to file
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(code)
        
        logger.info(f"Generated Moose models for {len(tables)} tables at {output_path}")
    
    def _generate_python_code(self, tables: List[TableMetadata]) -> str:
        """Generate the complete Python code for all models and pipelines."""
        lines = [
            '"""',
            'Generated Moose models and pipelines.',
            'This file was automatically generated from database metadata.',
            '"""',
            '',
            'from typing import Optional',
            'from datetime import datetime',
            'from moose_lib import BaseModel, Key, Field, OlapTable, OlapConfig',
            '',
        ]
        
        # Add SAP HANA validator imports if enabled
        if self.config.use_sap_hana_validators:
            lines.extend([
                'from moose_lib_extras import (',
                '    # Base model',
                '    SapHanaBaseModel,',
                '    ',
                '    # Datetime types',
                '    SapDate, SapTime, SapSecondDate, SapTimestamp,',
                '    ',
                '    # Numeric types',
                '    SapTinyInt, SapSmallInt, SapInteger, SapBigInt,',
                '    SapSmallDecimal, SapDecimal, SapReal, SapDouble,',
                '    ',
                '    # Boolean type',
                '    SapBoolean,',
                '    ',
                '    # Character string types',
                '    SapVarchar, SapNvarchar, SapAlphanum, SapShortText,',
                '    ',
                '    # Binary types',
                '    SapVarbinary,',
                '    ',
                '    # Large Object types',
                '    SapBlob, SapClob, SapNclob, SapText,',
                '    ',
                '    # Multi-valued types',
                '    SapArray,',
                '    ',
                '    # Spatial types',
                '    SapStGeometry, SapStPoint,',
                ')',
                '',
            ])
        
        # Generate models
        for table in tables:
            model_code = self._generate_model_code(table)
            lines.extend(model_code)
            lines.append('')  # Add blank line between models
        
        # Generate OlapTable instances
        for table in tables:
            olap_table_code = self._generate_olap_table_code(table)
            lines.extend(olap_table_code)

        return '\n'.join(lines)
    
    def _generate_model_code(self, table: TableMetadata) -> List[str]:
        """Generate Python model code for a single table."""
        class_name = self._to_pascal_case(table.table_name)
        
        # Choose base class based on configuration
        if self.config.use_sap_hana_validators:
            base_class = 'SapHanaBaseModel'
        else:
            base_class = 'BaseModel'
        
        lines = [
            f'class {class_name}({base_class}):',
        ]
        
        # Add class docstring if comments are enabled
        if self.config.include_field_comments:
            lines.extend([
                '    """',
                f'    Model for SAP HANA table: {table.table_name}',
                f'    Schema: {table.schema_name}',
                '    """',
                '',
            ])
        
        # Generate field definitions
        for field in table.fields:
            field_def = self._generate_field_definition(field, table)
            lines.append(field_def)
        
        return lines
    
    def _generate_olap_table_code(self, table: TableMetadata) -> List[str]:
        """Generate OlapTable code for a single table."""
        class_name = self._to_pascal_case(table.table_name)
        variable_name = self._to_snake_case(table.table_name)
        
        if self._has_primary_key(table):
            # Table has primary key, use simple OlapTable creation
            lines = [
                f'{variable_name} = OlapTable[{class_name}]("{table.table_name}")',
            ]
        else:
            # Table has no primary key, use OlapTableConfig with orderByFields
            order_fields = self._get_order_by_fields(table)
            order_fields_str = ', '.join(f'"{field}"' for field in order_fields)
            
            lines = [
                f'{variable_name} = OlapTable[{class_name}]("{table.table_name}", OlapConfig(',
                f'    order_by_fields=[{order_fields_str}]',
                '))',
            ]
        
        return lines
    
    def _has_primary_key(self, table: TableMetadata) -> bool:
        """Check if table has any primary key fields."""
        return any(field.is_primary_key for field in table.fields)
    
    def _get_order_by_fields(self, table: TableMetadata) -> List[str]:
        """Get list of field names to use for ordering when no primary key exists."""
        # Use the first few fields as order by fields
        # Prioritize fields that might be good for ordering (timestamps, IDs, etc.)
        order_fields = []
        
        # First, try to find timestamp fields
        for field in table.fields:
            if self._is_timestamp_field(field):
                order_fields.append(self._sanitize_field_name(field.name))
                if len(order_fields) >= 2:  # Limit to 2 timestamp fields
                    break
        
        # If we don't have enough timestamp fields, add other fields
        for field in table.fields:
            if field.name not in [f for f in order_fields]:
                order_fields.append(self._sanitize_field_name(field.name))
                if len(order_fields) >= 2:  # Limit to 2 fields total
                    break
        
        return order_fields
    
    def _generate_field_definition(self, field: FieldMetadata, table: TableMetadata) -> str:
        """Generate a single field definition for a model."""
        python_type = self._map_data_type(field.data_type)
        
        # Generate field name by replacing non-alphanumeric characters with underscores
        field_name = self._sanitize_field_name(field.name)
        
        # Check if field name needs an alias (contains non-alphanumeric characters) or starts with a non-alphanumeric character
        needs_alias = not field.name.replace('_', '').isalnum() or not field.name[0].isalnum()
        
        # Handle primary key fields
        if field.is_primary_key or field.name.lower() in self.config.primary_key_field_names:
            python_type = f'Key[{python_type}]'
        
        # Handle timestamp fields - only override if not using SAP HANA validators
        if self._is_timestamp_field(field) and not self.config.use_sap_hana_validators:
            python_type = 'datetime'
        
        # Build field definition
        field_parts = []
        
        # Determine field characteristics
        is_primary_key = field.is_primary_key or field.name.lower() in self.config.primary_key_field_names
        is_order_by_field = self._is_order_by_field(field, table)
        
        # Add field comment if enabled
        if self.config.include_field_comments:
            comment_parts = []
            if field.data_type:
                comment_parts.append(f"SAP HANA type: {field.data_type}")
            if field.is_primary_key:
                comment_parts.append("Primary key")
            if is_order_by_field:
                comment_parts.append("Order by field")
            if field.is_nullable:
                comment_parts.append("Nullable")
            elif self.config.force_all_fields_nullable and not field.is_primary_key and not is_order_by_field:
                comment_parts.append("Forced nullable")
            
            if comment_parts:
                comment = " | ".join(comment_parts)
                field_parts.append(f'    # {comment}')
        
        # Handle optional fields
        # Make field optional if:
        # 1. It's marked as nullable in the database, OR
        # 2. force_all_fields_nullable is True AND it's not a primary key
        # BUT NEVER make primary key fields or order-by fields optional
        should_be_optional = (
            not is_primary_key and 
            not is_order_by_field and (
                field.is_nullable or 
                self.config.force_all_fields_nullable
            )
        )
        
        if should_be_optional:
            python_type = f'Optional[{python_type}]'
            default_value = self._get_default_value(field)
            
            if needs_alias:
                field_def = f'{field_name}: {python_type} = Field(alias="{field.name}", default={default_value})'
            else:
                field_def = f'{field_name}: {python_type} = {default_value}'
        else:
            if needs_alias:
                field_def = f'{field_name}: {python_type} = Field(alias="{field.name}")'
            else:
                field_def = f'{field_name}: {python_type}'
        
        field_parts.append(f'    {field_def}')
        
        return '\n'.join(field_parts)
    
    def _map_data_type(self, hana_type: str) -> str:
        """Map SAP HANA data type to Python type or SAP HANA annotated type."""
        # Normalize the type name
        normalized_type = hana_type.upper().split('(')[0]  # Remove length/precision info
        
        if self.config.use_sap_hana_validators:
            return self.SAP_HANA_TYPE_MAPPING.get(normalized_type, self.SAP_HANA_TYPE_MAPPING['DEFAULT'])
        else:
            return self.FALLBACK_TYPE_MAPPING.get(normalized_type, self.FALLBACK_TYPE_MAPPING['DEFAULT'])
    
    def _is_timestamp_field(self, field: FieldMetadata) -> bool:
        """Check if a field should be treated as a timestamp."""
        if not self.config.include_timestamp_fields:
            return False
        
        field_name_lower = field.name.lower()
        return (
            field_name_lower in self.config.timestamp_field_names or
            'timestamp' in field_name_lower or
            'time' in field_name_lower
        )
    
    def _is_order_by_field(self, field: FieldMetadata, table: TableMetadata) -> bool:
        """Check if a field is used for ordering in the OlapTable configuration."""
        # Get the order by fields for this table
        order_fields = self._get_order_by_fields(table)
        return field.name in order_fields
    
    def _get_default_value(self, field: FieldMetadata) -> str:
        """Get the default value for an optional field."""
        if field.default_value is not None:
            # Handle different default value types
            if field.default_value.upper() in ['NULL', 'NONE']:
                return 'None'
            elif field.default_value.upper() in ['TRUE', 'FALSE']:
                return 'True' if field.default_value.upper() == 'TRUE' else 'False'
            elif field.default_value.isdigit():
                return field.default_value
            else:
                return f'"{field.default_value}"'
        return 'None'
    
    
    def _to_pascal_case(self, name: str) -> str:
        """Convert string to PascalCase."""
        # Remove leading slashes and replace slashes with underscores
        cleaned_name = name.lstrip('/').replace('/', ' ')
        
        # Handle camelCase by inserting spaces before uppercase letters
        import re
        cleaned_name = re.sub(r'([a-z])([A-Z])', r'\1 \2', cleaned_name)
        
        # Handle common separators
        parts = cleaned_name.replace('_', ' ').replace('-', ' ').split()
        result = ''.join(word.capitalize() for word in parts)
        
        # Ensure the result starts with a letter (Python class name requirement)
        if result and not result[0].isalpha():
            result = 'Table' + result
        
        return result
    
    def _to_camel_case(self, name: str) -> str:
        """Convert string to camelCase."""
        pascal = self._to_pascal_case(name)
        return pascal[0].lower() + pascal[1:] if pascal else ''
    
    def _to_snake_case(self, name: str) -> str:
        """Convert string to snake_case."""
        import re
        # Insert underscore before uppercase letters that follow lowercase letters
        s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
        # Insert underscore before uppercase letters that follow digits or other uppercase letters
        s2 = re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1)
        return s2.lower()
    
    def _sanitize_field_name(self, name: str) -> str:
        """Sanitize field name by replacing non-alphanumeric characters with underscores."""
        import re
        # Replace non-alphanumeric characters (except underscores) with underscores
        sanitized = re.sub(r'[^a-zA-Z0-9_]', '_', name)
        # Remove multiple consecutive underscores
        sanitized = re.sub(r'_+', '_', sanitized)
        # Remove leading/trailing underscores
        sanitized = sanitized.strip('_')
        # Ensure it starts with a letter or underscore
        if sanitized and not sanitized[0].isalpha() and sanitized[0] != '_':
            sanitized = '_' + sanitized
        # Handle empty result
        if not sanitized:
            sanitized = 'field'
        return sanitized


def generate_moose_models(
    tables: List[TableMetadata], 
    output_path: str, 
    config: Optional[MooseModelConfig] = None
) -> None:
    """
    Convenience function to generate Moose models and pipelines.
    
    Args:
        tables: List of TableMetadata objects
        output_path: Path to write the generated Python file
        config: Optional configuration for model generation
    """
    generator = MooseModelGenerator(config)
    generator.generate_models(tables, output_path)