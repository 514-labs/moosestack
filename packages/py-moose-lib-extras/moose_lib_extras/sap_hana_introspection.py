"""
Database metadata generator for SAP HANA databases.

This module provides functionality to extract table metadata from SAP HANA databases
using hdbcli connections, including field names, types, and primary key information.
"""

from typing import List, Dict, Any, Optional, Union
from dataclasses import dataclass
import logging

try:
    import hdbcli.dbapi as hdb
except ImportError:
        raise ImportError("hdbcli is required but not installed. Install with: pip install hdbcli")

logger = logging.getLogger(__name__)


@dataclass
class FieldMetadata:
    """Represents metadata for a single database field."""
    
    name: str
    data_type: str
    is_primary_key: bool
    is_nullable: bool
    length: Optional[int] = None
    scale: Optional[int] = None
    default_value: Optional[str] = None


@dataclass
class TableMetadata:
    """Represents metadata for a database table."""
    
    table_name: str
    schema_name: str
    fields: List[FieldMetadata]
    
    def get_field_names(self) -> List[str]:
        """Get list of field names."""
        return [field.name for field in self.fields]
    
    def get_primary_key_fields(self) -> List[FieldMetadata]:
        """Get list of primary key fields."""
        return [field for field in self.fields if field.is_primary_key]
    
    def get_field_by_name(self, name: str) -> Optional[FieldMetadata]:
        """Get field metadata by name."""
        for field in self.fields:
            if field.name == name:
                return field
        return None


class HanaIntrospector:
    """Generator for database table metadata from SAP HANA databases."""
    
    def __init__(self, connection: hdb.Connection):
        """
        Initialize the metadata generator with a SAP HANA database connection.
        
        Args:
            connection: An active hdbcli.dbapi.Connection object
            
        Raises:
            ValueError: If hdbcli is not installed or connection is invalid
        """
        
        if not isinstance(connection, hdb.Connection):
            raise ValueError("connection must be an hdbcli.dbapi.Connection object")
        
        self.connection = connection
        self._validate_connection()
    
    def _validate_connection(self) -> None:
        """Validate that the database connection is active."""
        try:
            cursor = self.connection.cursor()
            cursor.execute("SELECT 1 FROM DUMMY")
            cursor.close()
        except Exception as e:
            raise ValueError(f"Invalid database connection: {e}")
    
    def get_table_metadata(self, table_names: List[str], schema_name: Optional[str] = None) -> List[TableMetadata]:
        """
        Get metadata for a list of database tables.
        
        Args:
            table_names: List of table names to get metadata for
            schema_name: Optional schema name. If None, uses current schema
            
        Returns:
            List of TableMetadata objects
            
        Raises:
            Exception: If there's an error querying the database
        """
        if not table_names:
            return []
        
        metadata_list = []
        
        for table_name in table_names:
            try:
                table_metadata = self._get_single_table_metadata(table_name, schema_name)
                metadata_list.append(table_metadata)
            except Exception as e:
                logger.error(f"Failed to get metadata for table {table_name}: {e}")
                raise
        
        return metadata_list
    
    def _get_single_table_metadata(self, table_name: str, schema_name: Optional[str] = None) -> TableMetadata:
        """Get metadata for a single table."""
        # Determine the full table name with schema
        if schema_name:
            full_table_name = f'"{schema_name}"."{table_name}"'
            actual_schema = schema_name
        else:
            full_table_name = f'"{table_name}"'
            # Get current schema
            actual_schema = self._get_current_schema()
        
        # Get column information
        # Note: If TABLE_COLUMNS doesn't exist, may need to use SYS.COLUMNS instead
        columns_query = """
        SELECT 
            COLUMN_NAME,
            DATA_TYPE_NAME,
            LENGTH,
            SCALE,
            IS_NULLABLE,
            DEFAULT_VALUE
        FROM TABLE_COLUMNS 
        WHERE SCHEMA_NAME = ? AND TABLE_NAME = ?
        ORDER BY POSITION
        """
        
        # Get primary key information
        pk_query = """
        SELECT COLUMN_NAME
        FROM SYS.CONSTRAINTS
        WHERE SCHEMA_NAME = ? 
            AND TABLE_NAME = ? 
            AND IS_PRIMARY_KEY = 'TRUE'
        ORDER BY POSITION
        """
        
        cursor = self.connection.cursor()
        
        try:
            # Get column metadata
            cursor.execute(columns_query, (actual_schema, table_name))
            columns = cursor.fetchall()
            
            if not columns:
                raise ValueError(f"Table '{table_name}' not found in schema '{actual_schema}'")
            
            # Get primary key columns
            cursor.execute(pk_query, (actual_schema, table_name))
            pk_columns = {row[0] for row in cursor.fetchall()}
            
            # Build field metadata
            fields = []
            for col in columns:
                field = FieldMetadata(
                    name=col[0],                    # COLUMN_NAME
                    data_type=col[1],              # DATA_TYPE_NAME
                    is_primary_key=col[0] in pk_columns,
                    is_nullable=col[4] == 'TRUE',  # IS_NULLABLE
                    length=col[2] if col[2] is not None else None,      # LENGTH
                    scale=col[3] if col[3] is not None else None,        # SCALE
                    default_value=col[5] if col[5] is not None else None # DEFAULT_VALUE
                )
                fields.append(field)
            
            return TableMetadata(
                table_name=table_name,
                schema_name=actual_schema,
                fields=fields
            )
            
        finally:
            cursor.close()
    
    def _get_current_schema(self) -> str:
        """Get the current schema name."""
        cursor = self.connection.cursor()
        try:
            cursor.execute("SELECT CURRENT_SCHEMA FROM DUMMY")
            result = cursor.fetchone()
            return result[0] if result else "PUBLIC"
        finally:
            cursor.close()
    
    def get_all_tables_in_schema(self, schema_name: Optional[str] = None) -> List[str]:
        """
        Get list of all table names in a schema.
        
        Args:
            schema_name: Schema name. If None, uses current schema
            
        Returns:
            List of table names
        """
        if schema_name is None:
            schema_name = self._get_current_schema()
        
        query = """
        SELECT DISTINCT TABLE_NAME 
        FROM TABLES 
        WHERE SCHEMA_NAME = ? 
        ORDER BY TABLE_NAME
        """
        cursor = self.connection.cursor()
        try:
            cursor.execute(query, (schema_name,))
            return [row[0] for row in cursor.fetchall()]
        finally:
            cursor.close()


def introspect_hana_database(
    connection: hdb.Connection, 
    table_names: List[str], 
    schema_name: Optional[str] = None
) -> List[TableMetadata]:
    """
    Convenience function to generate table metadata.
    
    Args:
        connection: SAP HANA database connection
        table_names: List of table names to get metadata for
        schema_name: Optional schema name
        
    Returns:
        List of TableMetadata objects
    """
    introspector = HanaIntrospector(connection)
    return introspector.get_table_metadata(table_names, schema_name)
