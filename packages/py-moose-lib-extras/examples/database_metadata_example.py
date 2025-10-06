"""
Example usage of the database metadata generator for SAP HANA.

This example demonstrates how to use the HanaIntrospector class
to extract table metadata from a SAP HANA database.
"""

import hdbcli.dbapi as hdb
from moose_lib_extras import HanaIntrospector, introspect_hana_database


def example_basic_usage():
    """Basic example of using the database metadata generator."""
    
    # Connect to SAP HANA database
    # Replace these connection parameters with your actual database details
    connection = hdb.connect(
        address="your-hana-server.com",
        port=30015,
        user="your_username",
        password="your_password",
        database="your_database"
    )
    
    try:
        # Method 1: Using the class-based approach
        generator = HanaIntrospector(connection)
        
        # Get metadata for specific tables
        table_names = ["USERS", "ORDERS", "PRODUCTS"]
        metadata_list = generator.get_table_metadata(table_names, schema_name="YOUR_SCHEMA")
        
        # Process the metadata
        for table_metadata in metadata_list:
            print(f"\nTable: {table_metadata.schema_name}.{table_metadata.table_name}")
            print("=" * 50)
            
            for field in table_metadata.fields:
                pk_indicator = " (PK)" if field.is_primary_key else ""
                nullable_indicator = "NULL" if field.is_nullable else "NOT NULL"
                print(f"  {field.name}: {field.data_type}{pk_indicator} - {nullable_indicator}")
                
                if field.length:
                    print(f"    Length: {field.length}")
                if field.scale:
                    print(f"    Scale: {field.scale}")
                if field.default_value:
                    print(f"    Default: {field.default_value}")
        
        # Method 2: Using the convenience function
        print("\n" + "="*60)
        print("Using convenience function:")
        print("="*60)
        
        metadata_list = introspect_hana_database(connection, table_names, "YOUR_SCHEMA")
        
        for table_metadata in metadata_list:
            print(f"\nTable: {table_metadata.table_name}")
            print(f"Primary key fields: {[f.name for f in table_metadata.get_primary_key_fields()]}")
            print(f"All field names: {table_metadata.get_field_names()}")
            
            # Get specific field information
            id_field = table_metadata.get_field_by_name("ID")
            if id_field:
                print(f"ID field type: {id_field.data_type}")
                print(f"ID is primary key: {id_field.is_primary_key}")
    
    finally:
        connection.close()


def example_get_all_tables():
    """Example of getting all tables in a schema."""
    
    connection = hdb.connect(
        address="your-hana-server.com",
        port=30015,
        user="your_username", 
        password="your_password",
        database="your_database"
    )
    
    try:
        generator = HanaIntrospector(connection)
        
        # Get all tables in the schema
        all_tables = generator.get_all_tables_in_schema("YOUR_SCHEMA")
        print(f"Found {len(all_tables)} tables in schema:")
        for table_name in all_tables:
            print(f"  - {table_name}")
        
        # Get metadata for all tables
        metadata_list = generator.get_table_metadata(all_tables, "YOUR_SCHEMA")
        
        # Create a summary
        print("\nTable Summary:")
        print("=" * 40)
        for table_metadata in metadata_list:
            pk_count = len(table_metadata.get_primary_key_fields())
            field_count = len(table_metadata.fields)
            print(f"{table_metadata.table_name}: {field_count} fields, {pk_count} primary key(s)")
    
    finally:
        connection.close()


def example_error_handling():
    """Example of proper error handling."""
    
    try:
        # This will fail if hdbcli is not installed
        connection = hdb.connect(
            address="invalid-server.com",
            port=30015,
            user="invalid_user",
            password="invalid_password"
        )
        
        generator = HanaIntrospector(connection)
        metadata = generator.get_table_metadata(["NONEXISTENT_TABLE"])
        
    except ValueError as e:
        print(f"Configuration error: {e}")
    except Exception as e:
        print(f"Database error: {e}")


if __name__ == "__main__":
    print("Database Metadata Generator Example")
    print("=" * 40)
    print("\nNote: Update the connection parameters before running this example.")
    print("This example demonstrates the functionality but requires a real SAP HANA connection.")
    
    # Uncomment these lines to run the examples with real database connections
    # example_basic_usage()
    # example_get_all_tables()
    # example_error_handling()
