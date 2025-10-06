"""
Unit tests for database metadata generator.
"""

import pytest
from unittest.mock import Mock, MagicMock, patch
from typing import List, Any

from moose_lib_extras.sap_hana_introspection import (
    FieldMetadata,
    TableMetadata,
    DatabaseMetadataGenerator,
    generate_table_metadata,
)


class TestFieldMetadata:
    """Test cases for FieldMetadata class."""
    
    def test_field_metadata_creation(self):
        """Test creating a FieldMetadata instance."""
        field = FieldMetadata(
            name="id",
            data_type="INTEGER",
            is_primary_key=True,
            is_nullable=False,
            length=10,
            scale=0,
            default_value="1"
        )
        
        assert field.name == "id"
        assert field.data_type == "INTEGER"
        assert field.is_primary_key is True
        assert field.is_nullable is False
        assert field.length == 10
        assert field.scale == 0
        assert field.default_value == "1"
    
    def test_field_metadata_minimal(self):
        """Test creating a FieldMetadata instance with minimal data."""
        field = FieldMetadata(
            name="name",
            data_type="VARCHAR",
            is_primary_key=False,
            is_nullable=True
        )
        
        assert field.name == "name"
        assert field.data_type == "VARCHAR"
        assert field.is_primary_key is False
        assert field.is_nullable is True
        assert field.length is None
        assert field.scale is None
        assert field.default_value is None


class TestTableMetadata:
    """Test cases for TableMetadata class."""
    
    def test_table_metadata_creation(self):
        """Test creating a TableMetadata instance."""
        fields = [
            FieldMetadata("id", "INTEGER", True, False),
            FieldMetadata("name", "VARCHAR", False, True),
            FieldMetadata("email", "VARCHAR", False, True)
        ]
        
        table = TableMetadata(
            table_name="users",
            schema_name="public",
            fields=fields
        )
        
        assert table.table_name == "users"
        assert table.schema_name == "public"
        assert len(table.fields) == 3
        assert table.get_field_names() == ["id", "name", "email"]
    
    def test_get_primary_key_fields(self):
        """Test getting primary key fields."""
        fields = [
            FieldMetadata("id", "INTEGER", True, False),
            FieldMetadata("name", "VARCHAR", False, True),
            FieldMetadata("email", "VARCHAR", True, True)  # Composite key
        ]
        
        table = TableMetadata("users", "public", fields)
        pk_fields = table.get_primary_key_fields()
        
        assert len(pk_fields) == 2
        assert pk_fields[0].name == "id"
        assert pk_fields[1].name == "email"
    
    def test_get_field_by_name(self):
        """Test getting field by name."""
        fields = [
            FieldMetadata("id", "INTEGER", True, False),
            FieldMetadata("name", "VARCHAR", False, True)
        ]
        
        table = TableMetadata("users", "public", fields)
        
        field = table.get_field_by_name("id")
        assert field is not None
        assert field.name == "id"
        assert field.data_type == "INTEGER"
        
        field = table.get_field_by_name("nonexistent")
        assert field is None


class TestDatabaseMetadataGenerator:
    """Test cases for DatabaseMetadataGenerator class."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.mock_connection = Mock()
        self.mock_cursor = Mock()
        self.mock_connection.cursor.return_value = self.mock_cursor
    
    def test_init_with_valid_connection(self):
        """Test initialization with valid connection."""
        # Mock successful connection validation
        self.mock_cursor.execute.return_value = None
        self.mock_cursor.fetchone.return_value = (1,)
        
        generator = DatabaseMetadataGenerator(self.mock_connection)
        assert generator.connection == self.mock_connection
    
    def test_init_without_hdbcli(self):
        """Test initialization without hdbcli installed."""
        with patch('moose_lib_extras.sap_hana_introspection.hdb', None):
            with pytest.raises(ValueError, match="hdbcli is required"):
                DatabaseMetadataGenerator(self.mock_connection)
    
    def test_init_with_invalid_connection(self):
        """Test initialization with invalid connection type."""
        with pytest.raises(ValueError, match="connection must be an hdbcli.dbapi.Connection"):
            DatabaseMetadataGenerator("not_a_connection")
    
    def test_init_with_inactive_connection(self):
        """Test initialization with inactive connection."""
        self.mock_cursor.execute.side_effect = Exception("Connection failed")
        
        with pytest.raises(ValueError, match="Invalid database connection"):
            DatabaseMetadataGenerator(self.mock_connection)
    
    def test_get_table_metadata_empty_list(self):
        """Test getting metadata for empty table list."""
        self.mock_cursor.execute.return_value = None
        self.mock_cursor.fetchone.return_value = (1,)
        
        generator = DatabaseMetadataGenerator(self.mock_connection)
        result = generator.get_table_metadata([])
        
        assert result == []
    
    def test_get_table_metadata_single_table(self):
        """Test getting metadata for a single table."""
        # Mock connection validation
        self.mock_cursor.execute.return_value = None
        self.mock_cursor.fetchone.return_value = ("public",)
        
        # Mock column data
        columns_data = [
            ("id", "INTEGER", 10, 0, "FALSE", None),
            ("name", "VARCHAR", 255, None, "TRUE", None)
        ]
        
        # Mock primary key data
        pk_data = [("id",)]
        
        # Set up mock responses
        def mock_execute(query, params=None):
            if "TABLE_COLUMNS" in query:
                self.mock_cursor.fetchall.return_value = columns_data
            elif "SYS.CONSTRAINTS" in query and "IS_PRIMARY_KEY" in query:
                self.mock_cursor.fetchall.return_value = pk_data
        
        self.mock_cursor.execute.side_effect = mock_execute
        
        generator = DatabaseMetadataGenerator(self.mock_connection)
        result = generator.get_table_metadata(["users"])
        
        assert len(result) == 1
        table = result[0]
        assert table.table_name == "users"
        assert table.schema_name == "public"
        assert len(table.fields) == 2
        
        # Check field details
        id_field = table.get_field_by_name("id")
        assert id_field is not None
        assert id_field.data_type == "INTEGER"
        assert id_field.is_primary_key is True
        assert id_field.is_nullable is False
        
        name_field = table.get_field_by_name("name")
        assert name_field is not None
        assert name_field.data_type == "VARCHAR"
        assert name_field.is_primary_key is False
        assert name_field.is_nullable is True
    
    def test_get_table_metadata_with_schema(self):
        """Test getting metadata with specific schema."""
        # Mock connection validation
        self.mock_cursor.execute.return_value = None
        self.mock_cursor.fetchone.return_value = ("test_schema",)
        
        # Mock column data
        columns_data = [("id", "INTEGER", 10, 0, "FALSE", None)]
        pk_data = [("id",)]
        
        def mock_execute(query, params=None):
            if "TABLE_COLUMNS" in query:
                self.mock_cursor.fetchall.return_value = columns_data
            elif "SYS.CONSTRAINTS" in query and "IS_PRIMARY_KEY" in query:
                self.mock_cursor.fetchall.return_value = pk_data
        
        self.mock_cursor.execute.side_effect = mock_execute
        
        generator = DatabaseMetadataGenerator(self.mock_connection)
        result = generator.get_table_metadata(["users"], "test_schema")
        
        assert len(result) == 1
        table = result[0]
        assert table.schema_name == "test_schema"
    
    def test_get_table_metadata_table_not_found(self):
        """Test getting metadata for non-existent table."""
        # Mock connection validation
        self.mock_cursor.execute.return_value = None
        self.mock_cursor.fetchone.return_value = ("public",)
        
        # Mock empty column data (table not found)
        self.mock_cursor.fetchall.return_value = []
        
        generator = DatabaseMetadataGenerator(self.mock_connection)
        
        with pytest.raises(ValueError, match="Table 'nonexistent' not found"):
            generator.get_table_metadata(["nonexistent"])
    
    def test_get_all_tables_in_schema(self):
        """Test getting all tables in a schema."""
        # Mock connection validation
        self.mock_cursor.execute.return_value = None
        self.mock_cursor.fetchone.return_value = ("public",)
        
        # Mock table list
        tables_data = [("users",), ("orders",), ("products",)]
        self.mock_cursor.fetchall.return_value = tables_data
        
        generator = DatabaseMetadataGenerator(self.mock_connection)
        tables = generator.get_all_tables_in_schema("test_schema")
        
        assert tables == ["users", "orders", "products"]
    
    def test_get_current_schema(self):
        """Test getting current schema."""
        # Mock connection validation
        self.mock_cursor.execute.return_value = None
        self.mock_cursor.fetchone.return_value = ("public",)
        
        # Mock schema query
        def mock_execute(query, params=None):
            if "CURRENT_SCHEMA" in query:
                self.mock_cursor.fetchone.return_value = ("test_schema",)
        
        self.mock_cursor.execute.side_effect = mock_execute
        
        generator = DatabaseMetadataGenerator(self.mock_connection)
        schema = generator._get_current_schema()
        
        assert schema == "test_schema"


class TestGenerateTableMetadata:
    """Test cases for generate_table_metadata convenience function."""
    
    def test_generate_table_metadata(self):
        """Test the convenience function."""
        mock_connection = Mock()
        mock_cursor = Mock()
        mock_connection.cursor.return_value = mock_cursor
        
        # Mock connection validation
        mock_cursor.execute.return_value = None
        mock_cursor.fetchone.return_value = ("public",)
        
        # Mock column data
        columns_data = [("id", "INTEGER", 10, 0, "FALSE", None)]
        pk_data = [("id",)]
        
        def mock_execute(query, params=None):
            if "TABLE_COLUMNS" in query:
                mock_cursor.fetchall.return_value = columns_data
            elif "SYS.CONSTRAINTS" in query and "IS_PRIMARY_KEY" in query:
                mock_cursor.fetchall.return_value = pk_data
        
        mock_cursor.execute.side_effect = mock_execute
        
        result = generate_table_metadata(mock_connection, ["users"])
        
        assert len(result) == 1
        assert result[0].table_name == "users"
