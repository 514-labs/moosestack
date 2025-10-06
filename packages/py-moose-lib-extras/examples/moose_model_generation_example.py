"""
Example usage of the Moose model generator.

This example demonstrates how to use the MooseModelGenerator to create
Python models and pipelines from database metadata.
"""

import hdbcli.dbapi as hdb
from moose_lib_extras import (
    HanaIntrospector,
    introspect_hana_database,
    MooseModelGenerator,
    MooseModelConfig,
    generate_moose_models,
)


def example_basic_model_generation():
    """Basic example of generating Moose models from database metadata."""
    
    # Connect to SAP HANA database
    connection = hdb.connect(
        address="your-hana-server.com",
        port=30015,
        user="your_username",
        password="your_password",
        database="your_database"
    )
    
    try:
        # Get table metadata
        table_names = ["USERS", "ORDERS", "PRODUCTS"]
        tables_metadata = introspect_hana_database(connection, table_names, "YOUR_SCHEMA")
        
        # Generate Moose models using the convenience function
        generate_moose_models(tables_metadata, "generated_models.py")
        
        print("✅ Generated Moose models successfully!")
        print("📁 Check 'generated_models.py' for the output")
        
    finally:
        connection.close()


def example_custom_configuration():
    """Example with custom configuration for model generation."""
    
    # Create custom configuration
    config = MooseModelConfig(
        default_ingest=False,
        default_stream=True,
        default_table=True,
        include_timestamp_fields=True,
        timestamp_field_names={'created_at', 'updated_at', 'timestamp'},
        primary_key_field_names={'id', 'pk', 'primary_key'}
    )
    
    # Create generator with custom config
    generator = MooseModelGenerator(config)
    
    # Mock table metadata for demonstration
    from moose_lib_extras.sap_hana_introspection import FieldMetadata, TableMetadata
    
    sample_tables = [
        TableMetadata("users", "public", [
            FieldMetadata("id", "INTEGER", True, False),
            FieldMetadata("username", "VARCHAR", False, False),
            FieldMetadata("email", "VARCHAR", False, True),
            FieldMetadata("created_at", "TIMESTAMP", False, True),
            FieldMetadata("is_active", "BOOLEAN", False, False)
        ]),
        TableMetadata("orders", "public", [
            FieldMetadata("id", "INTEGER", True, False),
            FieldMetadata("user_id", "INTEGER", False, False),
            FieldMetadata("total_amount", "DECIMAL", False, False, scale=2),
            FieldMetadata("order_date", "TIMESTAMP", False, False),
            FieldMetadata("status", "VARCHAR", False, False)
        ]),
        TableMetadata("sap_data", "public", [
            FieldMetadata("/OSP/OLORE01", "VARCHAR", True, False),
            FieldMetadata("/OSP/OLORE02", "INTEGER", False, True),
            FieldMetadata("normal_field", "VARCHAR", False, False),
            FieldMetadata("is_active", "BOOLEAN", False, True, default_value="TRUE"),
            FieldMetadata("is_deleted", "BOOLEAN", False, True, default_value="FALSE")
        ])
    ]
    
    # Generate models with custom configuration
    generator.generate_models(sample_tables, "custom_models.py")
    
    print("✅ Generated custom Moose models successfully!")
    print("📁 Check 'custom_models.py' for the output")


def example_advanced_usage():
    """Advanced example showing different table types and configurations."""
    
    # Create different configurations for different table types
    log_config = MooseModelConfig(
        default_ingest=False,
        default_stream=True,
        default_table=True,
        default_dead_letter_queue=True
    )
    
    staging_config = MooseModelConfig(
        default_ingest=True,
        default_stream=False,
        default_table=False,
        default_dead_letter_queue=False
    )
    
    # Mock different types of tables
    from moose_lib_extras.sap_hana_introspection import FieldMetadata, TableMetadata
    
    # Log table
    log_table = TableMetadata("audit_log", "public", [
        FieldMetadata("id", "INTEGER", True, False),
        FieldMetadata("user_id", "INTEGER", False, False),
        FieldMetadata("action", "VARCHAR", False, False),
        FieldMetadata("timestamp", "TIMESTAMP", False, False),
        FieldMetadata("details", "TEXT", False, True)
    ])
    
    # Staging table
    staging_table = TableMetadata("staging_import", "public", [
        FieldMetadata("id", "INTEGER", True, False),
        FieldMetadata("raw_data", "JSON", False, False),
        FieldMetadata("import_date", "TIMESTAMP", False, False),
        FieldMetadata("status", "VARCHAR", False, False)
    ])
    
    # Generate models for log table
    log_generator = MooseModelGenerator(log_config)
    log_generator.generate_models([log_table], "log_models.py")
    
    # Generate models for staging table
    staging_generator = MooseModelGenerator(staging_config)
    staging_generator.generate_models([staging_table], "staging_models.py")
    
    print("✅ Generated specialized Moose models successfully!")
    print("📁 Check 'log_models.py' and 'staging_models.py' for the output")


def example_workflow_integration():
    """Example showing integration with a complete workflow."""
    
    print("🔄 Complete workflow example:")
    print("1. Connect to SAP HANA database")
    print("2. Introspect table metadata")
    print("3. Generate Moose models")
    print("4. Use generated models in your application")
    
    # Step 1: Database connection
    connection = hdb.connect(
        address="your-hana-server.com",
        port=30015,
        user="your_username",
        password="your_password",
        database="your_database"
    )
    
    try:
        # Step 2: Introspect database
        introspector = HanaIntrospector(connection)
        
        # Get all tables in schema
        all_tables = introspector.get_all_tables_in_schema("YOUR_SCHEMA")
        print(f"📊 Found {len(all_tables)} tables in schema")
        
        # Get metadata for all tables
        tables_metadata = introspector.get_table_metadata(all_tables, "YOUR_SCHEMA")
        
        # Step 3: Generate models
        generator = MooseModelGenerator()
        generator.generate_models(tables_metadata, "complete_models.py")
        
        print("✅ Complete workflow finished successfully!")
        print("📁 Generated 'complete_models.py' with all table models")
        
        # Step 4: Show how to use generated models
        print("\n📝 To use the generated models in your application:")
        print("   from complete_models import *")
        print("   # Now you can use the models and pipelines")
        
    finally:
        connection.close()


def show_generated_example():
    """Show what the generated code looks like."""
    
    print("📄 Example of generated Moose models:")
    print("=" * 50)
    
    example_code = '''"""
Generated Moose models and pipelines.
This file was automatically generated from database metadata.
"""

from typing import Optional
from datetime import datetime
from moose_lib import BaseModel, Key, IngestPipeline, IngestPipelineConfig, Field


class Users(BaseModel):
    id: Key[int]
    username: str
    email: Optional[str] = None
    created_at: Optional[datetime] = None
    is_active: bool


class Orders(BaseModel):
    id: Key[int]
    user_id: int
    total_amount: float
    order_date: datetime
    status: str


class SapData(BaseModel):
    OSP_OLORE01: Key[str] = Field(alias="/OSP/OLORE01")
    OSP_OLORE02: Optional[int] = Field(alias="/OSP/OLORE02", default=None)
    normal_field: str
    is_active: Optional[bool] = True
    is_deleted: Optional[bool] = False


usersModel = IngestPipeline[Users]("Users", IngestPipelineConfig(
    ingest=True,
    stream=True,
    table=False,
    dead_letter_queue=True
))

ordersModel = IngestPipeline[Orders]("Orders", IngestPipelineConfig(
    ingest=True,
    stream=True,
    table=False,
    dead_letter_queue=True
))

sapDataModel = IngestPipeline[SapData]("SapData", IngestPipelineConfig(
    ingest=True,
    stream=True,
    table=False,
    dead_letter_queue=True
))'''
    
    print(example_code)


if __name__ == "__main__":
    print("Moose Model Generator Examples")
    print("=" * 40)
    
    # Show what generated code looks like
    show_generated_example()
    
    print("\n" + "=" * 40)
    print("Note: Update the connection parameters before running these examples.")
    print("These examples demonstrate the functionality but require a real SAP HANA connection.")
    
    # Uncomment these lines to run the examples with real database connections
    # example_basic_model_generation()
    # example_custom_configuration()
    # example_advanced_usage()
    # example_workflow_integration()
