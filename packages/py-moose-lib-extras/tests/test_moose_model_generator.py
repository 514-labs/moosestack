"""
Unit tests for Moose model generator.
"""

import pytest
from unittest.mock import Mock, patch
from pathlib import Path
import tempfile
import os

from moose_lib_extras.moose_model_generator import (
    MooseModelConfig,
    MooseModelGenerator,
    generate_moose_models,
)
from moose_lib_extras.sap_hana_introspection import (
    FieldMetadata,
    TableMetadata,
)


class TestMooseModelConfig:
    """Test cases for MooseModelConfig class."""
    
    def test_default_config(self):
        """Test default configuration values."""
        config = MooseModelConfig()
        
        assert config.default_ingest is True
        assert config.default_stream is True
        assert config.default_table is False
        assert config.default_dead_letter_queue is True
        assert config.include_timestamp_fields is True
        assert 'timestamp' in config.timestamp_field_names
        assert 'id' in config.primary_key_field_names
    
    def test_custom_config(self):
        """Test custom configuration values."""
        config = MooseModelConfig(
            default_ingest=False,
            default_stream=False,
            include_timestamp_fields=False,
            timestamp_field_names={'custom_time'},
            primary_key_field_names={'custom_id'}
        )
        
        assert config.default_ingest is False
        assert config.default_stream is False
        assert config.include_timestamp_fields is False
        assert config.timestamp_field_names == {'custom_time'}
        assert config.primary_key_field_names == {'custom_id'}


class TestMooseModelGenerator:
    """Test cases for MooseModelGenerator class."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.config = MooseModelConfig()
        self.generator = MooseModelGenerator(self.config)
        
        # Create sample table metadata
        self.sample_fields = [
            FieldMetadata("id", "INTEGER", True, False),
            FieldMetadata("name", "VARCHAR", False, True),
            FieldMetadata("timestamp", "TIMESTAMP", False, True),
            FieldMetadata("is_active", "BOOLEAN", False, False),
            FieldMetadata("score", "DECIMAL", False, True, scale=2)
        ]
        
        self.sample_table = TableMetadata(
            table_name="users",
            schema_name="public",
            fields=self.sample_fields
        )
    
    def test_type_mapping(self):
        """Test SAP HANA to Python type mapping."""
        assert self.generator._map_data_type("INTEGER") == "int"
        assert self.generator._map_data_type("VARCHAR") == "str"
        assert self.generator._map_data_type("TIMESTAMP") == "datetime"
        assert self.generator._map_data_type("BOOLEAN") == "bool"
        assert self.generator._map_data_type("DECIMAL") == "float"
        assert self.generator._map_data_type("UNKNOWN_TYPE") == "str"  # Default
    
    def test_timestamp_field_detection(self):
        """Test timestamp field detection."""
        timestamp_field = FieldMetadata("timestamp", "TIMESTAMP", False, True)
        non_timestamp_field = FieldMetadata("name", "VARCHAR", False, True)
        
        assert self.generator._is_timestamp_field(timestamp_field) is True
        assert self.generator._is_timestamp_field(non_timestamp_field) is False
        
        # Test with custom timestamp field names
        custom_config = MooseModelConfig(timestamp_field_names={'created_at'})
        custom_generator = MooseModelGenerator(custom_config)
        
        created_at_field = FieldMetadata("created_at", "VARCHAR", False, True)
        assert custom_generator._is_timestamp_field(created_at_field) is True
    
    def test_case_conversion(self):
        """Test case conversion methods."""
        assert self.generator._to_pascal_case("user_table") == "UserTable"
        assert self.generator._to_pascal_case("user-table") == "UserTable"
        assert self.generator._to_pascal_case("userTable") == "UserTable"
        
        assert self.generator._to_camel_case("user_table") == "userTable"
        assert self.generator._to_camel_case("UserTable") == "userTable"
        
        assert self.generator._to_snake_case("UserTable") == "user_table"
        assert self.generator._to_snake_case("userTable") == "user_table"
        assert self.generator._to_snake_case("user_table") == "user_table"
    
    def test_field_definition_generation(self):
        """Test field definition generation."""
        # Primary key field
        pk_field = FieldMetadata("id", "INTEGER", True, False)
        pk_def = self.generator._generate_field_definition(pk_field)
        assert pk_def == "id: Key[int]"
        
        # Optional field
        optional_field = FieldMetadata("name", "VARCHAR", False, True)
        optional_def = self.generator._generate_field_definition(optional_field)
        assert optional_def == "name: Optional[str] = None"
        
        # Timestamp field
        timestamp_field = FieldMetadata("timestamp", "TIMESTAMP", False, True)
        timestamp_def = self.generator._generate_field_definition(timestamp_field)
        assert timestamp_def == "timestamp: Optional[datetime] = None"
        
        # Required field
        required_field = FieldMetadata("is_active", "BOOLEAN", False, False)
        required_def = self.generator._generate_field_definition(required_field)
        assert required_def == "is_active: bool"
        
        # Field with slash
        slash_field = FieldMetadata("/OSP/OLORE01", "VARCHAR", False, True)
        slash_def = self.generator._generate_field_definition(slash_field)
        assert slash_def == 'OSP_OLORE01: Optional[str] = Field(alias="/OSP/OLORE01", default=None)'
        
        # Field with slash and primary key
        slash_pk_field = FieldMetadata("/OSP/OLORE01", "VARCHAR", True, False)
        slash_pk_def = self.generator._generate_field_definition(slash_pk_field)
        assert slash_pk_def == 'OSP_OLORE01: Key[str] = Field(alias="/OSP/OLORE01")'
    
    def test_sanitize_field_name(self):
        """Test field name sanitization."""
        # Test slash replacement
        assert self.generator._sanitize_field_name("/OSP/OLORE01") == "OSP_OLORE01"
        
        # Test multiple special characters
        assert self.generator._sanitize_field_name("field-name@test") == "field_name_test"
        
        # Test normal field name (no change)
        assert self.generator._sanitize_field_name("normal_field") == "normal_field"
        
        # Test field starting with number
        assert self.generator._sanitize_field_name("123field") == "_123field"
        
        # Test empty field name
        assert self.generator._sanitize_field_name("") == "field"
        
        # Test field with only special characters
        assert self.generator._sanitize_field_name("!!!") == "field"
    
    def test_boolean_default_values(self):
        """Test boolean default value formatting."""
        # Boolean field with TRUE default
        true_field = FieldMetadata("is_active", "BOOLEAN", False, True, default_value="TRUE")
        true_def = self.generator._generate_field_definition(true_field)
        assert true_def == "is_active: Optional[bool] = True"
        
        # Boolean field with FALSE default
        false_field = FieldMetadata("is_deleted", "BOOLEAN", False, True, default_value="FALSE")
        false_def = self.generator._generate_field_definition(false_field)
        assert false_def == "is_deleted: Optional[bool] = False"
        
        # Boolean field with true default (lowercase)
        true_lower_field = FieldMetadata("is_enabled", "BOOLEAN", False, True, default_value="true")
        true_lower_def = self.generator._generate_field_definition(true_lower_field)
        assert true_lower_def == "is_enabled: Optional[bool] = True"
        
        # Boolean field with false default (lowercase)
        false_lower_field = FieldMetadata("is_disabled", "BOOLEAN", False, True, default_value="false")
        false_lower_def = self.generator._generate_field_definition(false_lower_field)
        assert false_lower_def == "is_disabled: Optional[bool] = False"
    
    def test_pipeline_config_determination(self):
        """Test pipeline configuration determination."""
        # Log table
        log_table = TableMetadata("audit_log", "public", [])
        log_config = self.generator._determine_pipeline_config(log_table)
        assert log_config['ingest'] is False
        assert log_config['stream'] is True
        assert log_config['table'] is True
        
        # Staging table
        staging_table = TableMetadata("staging_data", "public", [])
        staging_config = self.generator._determine_pipeline_config(staging_table)
        assert staging_config['ingest'] is True
        assert staging_config['stream'] is False
        assert staging_config['table'] is False
        
        # Dimension table
        dim_table = TableMetadata("dim_customer", "public", [])
        dim_config = self.generator._determine_pipeline_config(dim_table)
        assert dim_config['ingest'] is False
        assert dim_config['stream'] is False
        assert dim_config['table'] is True
        
        # Regular table (default config)
        regular_table = TableMetadata("users", "public", [])
        regular_config = self.generator._determine_pipeline_config(regular_table)
        assert regular_config['ingest'] is True
        assert regular_config['stream'] is True
        assert regular_config['table'] is False
    
    def test_model_generation(self):
        """Test model code generation."""
        model_code = self.generator._generate_model_code(self.sample_table)
        
        assert "class Users(BaseModel):" in model_code
        assert "id: Key[int]" in model_code
        assert "name: Optional[str] = None" in model_code
        assert "timestamp: Optional[datetime] = None" in model_code
        assert "is_active: bool" in model_code
        assert "score: Optional[float] = None" in model_code
    
    def test_pipeline_generation(self):
        """Test pipeline code generation."""
        pipeline_code = self.generator._generate_pipeline_code(self.sample_table)
        
        assert "usersModel = IngestPipeline[Users]" in pipeline_code
        assert 'ingest=True' in pipeline_code
        assert 'stream=True' in pipeline_code
        assert 'table=False' in pipeline_code
        assert 'dead_letter_queue=True' in pipeline_code
    
    def test_generate_models_file_creation(self):
        """Test that generate_models creates the output file."""
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = os.path.join(temp_dir, "generated_models.py")
            
            self.generator.generate_models([self.sample_table], output_path)
            
            assert os.path.exists(output_path)
            
            # Check file content
            with open(output_path, 'r') as f:
                content = f.read()
            
            assert "Generated Moose models and pipelines" in content
            assert "from moose_lib import BaseModel, Key, IngestPipeline, IngestPipelineConfig, Field" in content
            assert "class Users(BaseModel):" in content
            assert "usersModel = IngestPipeline[Users]" in content
    
    def test_generate_models_empty_list(self):
        """Test generate_models with empty table list."""
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = os.path.join(temp_dir, "empty_models.py")
            
            # Should not create file for empty list
            self.generator.generate_models([], output_path)
            assert not os.path.exists(output_path)
    
    def test_generate_models_multiple_tables(self):
        """Test generate_models with multiple tables."""
        table1 = TableMetadata("users", "public", [
            FieldMetadata("id", "INTEGER", True, False),
            FieldMetadata("name", "VARCHAR", False, True)
        ])
        
        table2 = TableMetadata("orders", "public", [
            FieldMetadata("id", "INTEGER", True, False),
            FieldMetadata("user_id", "INTEGER", False, False)
        ])
        
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = os.path.join(temp_dir, "multiple_models.py")
            
            self.generator.generate_models([table1, table2], output_path)
            
            with open(output_path, 'r') as f:
                content = f.read()
            
            assert "class Users(BaseModel):" in content
            assert "class Orders(BaseModel):" in content
            assert "usersModel = IngestPipeline[Users]" in content
            assert "ordersModel = IngestPipeline[Orders]" in content


class TestGenerateMooseModels:
    """Test cases for generate_moose_models convenience function."""
    
    def test_convenience_function(self):
        """Test the convenience function works correctly."""
        table = TableMetadata("test_table", "public", [
            FieldMetadata("id", "INTEGER", True, False),
            FieldMetadata("name", "VARCHAR", False, True)
        ])
        
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = os.path.join(temp_dir, "convenience_test.py")
            
            generate_moose_models([table], output_path)
            
            assert os.path.exists(output_path)
            
            with open(output_path, 'r') as f:
                content = f.read()
            
            assert "class TestTable(BaseModel):" in content
            assert "testTableModel = IngestPipeline[TestTable]" in content
    
    def test_convenience_function_with_config(self):
        """Test the convenience function with custom config."""
        table = TableMetadata("test_table", "public", [
            FieldMetadata("id", "INTEGER", True, False),
            FieldMetadata("name", "VARCHAR", False, True)
        ])
        
        config = MooseModelConfig(default_ingest=False)
        
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = os.path.join(temp_dir, "config_test.py")
            
            generate_moose_models([table], output_path, config)
            
            with open(output_path, 'r') as f:
                content = f.read()
            
            assert 'ingest=False' in content
