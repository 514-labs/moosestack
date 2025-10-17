# SAP HANA Data Type Validators

This module provides comprehensive validation and type conversion for all SAP HANA data types, ensuring proper handling of data from SAP HANA databases in Pydantic models.

## Features

- **Complete SAP HANA Type Coverage**: Support for all SAP HANA data types
- **Memory Buffer Handling**: Proper conversion of binary data and memory buffers
- **Custom Annotated Types**: Type-safe annotations for Pydantic models
- **Automatic Validation**: Built-in validation with proper error handling
- **Dynamic Model Creation**: Create Pydantic models from SAP HANA schemas

## Supported SAP HANA Data Types

### Datetime Types
- `DATE` - Date values
- `TIME` - Time values  
- `SECONDDATE` - Timestamp with seconds precision
- `TIMESTAMP` - Full timestamp values

### Numeric Types
- `TINYINT` - 8-bit integer (0-255)
- `SMALLINT` - 16-bit integer (-32768 to 32767)
- `INTEGER` - 32-bit integer (-2147483648 to 2147483647)
- `BIGINT` - 64-bit integer
- `SMALLDECIMAL` - Small decimal numbers
- `DECIMAL` - Decimal numbers
- `REAL` - 32-bit floating point
- `DOUBLE` - 64-bit floating point

### Boolean Type
- `BOOLEAN` - True/false values

### Character String Types
- `VARCHAR` - Variable-length character strings
- `NVARCHAR` - Variable-length Unicode strings
- `ALPHANUM` - Alphanumeric strings
- `SHORTTEXT` - Short text strings

### Binary Types
- `VARBINARY` - Variable-length binary data

### Large Object Types
- `BLOB` - Binary large objects
- `CLOB` - Character large objects
- `NCLOB` - Unicode character large objects
- `TEXT` - Text large objects

### Multi-valued Types
- `ARRAY` - Array values

### Spatial Types
- `ST_GEOMETRY` - Spatial geometry data
- `ST_POINT` - Spatial point data

## Usage Examples

### 1. Using Custom Annotated Types

```python
from moose_lib_extras import SapHanaBaseModel, SapDate, SapDecimal, SapVarchar, SapBlob
from pydantic import Field

class CustomerModel(SapHanaBaseModel):
    customer_id: SapVarchar = Field(alias="CUSTOMER_ID")
    created_date: SapDate = Field(alias="CREATED_DATE")
    account_balance: SapDecimal = Field(alias="ACCOUNT_BALANCE")
    profile_image: SapBlob = Field(alias="PROFILE_IMAGE")

# Create instance from SAP HANA data
customer_data = {
    "CUSTOMER_ID": "CUST001",
    "CREATED_DATE": "2024-01-15",
    "ACCOUNT_BALANCE": "1500.50",
    "PROFILE_IMAGE": b"binary_image_data"
}

customer = CustomerModel(**customer_data)
print(f"Customer: {customer.customer_id}")
print(f"Balance: {customer.account_balance} (type: {type(customer.account_balance)})")
```

### 2. Direct Validator Usage

```python
from moose_lib_extras import validate_sap_hana_value

# Validate different data types
date_value = validate_sap_hana_value("2024-01-15", "DATE")
decimal_value = validate_sap_hana_value("123.45", "DECIMAL")
binary_value = validate_sap_hana_value(b"Hello World", "VARBINARY")

print(f"Date: {date_value} (type: {type(date_value)})")
print(f"Decimal: {decimal_value} (type: {type(decimal_value)})")
print(f"Binary: {binary_value[:20]}... (base64 encoded)")
```

### 3. Dynamic Model Creation

```python
from moose_lib_extras import create_sap_hana_model_class

# Define table schema
table_schema = {
    'CUSTOMER_ID': 'VARCHAR',
    'CREATED_DATE': 'DATE',
    'ACCOUNT_BALANCE': 'DECIMAL',
    'IS_ACTIVE': 'BOOLEAN',
    'PROFILE_IMAGE': 'BLOB',
}

# Create model dynamically
CustomerModel = create_sap_hana_model_class('Customer', table_schema)

# Get field types
field_types = CustomerModel.get_sap_hana_field_types()
print(f"Field types: {field_types}")
```

### 4. Handling Memory Buffers

The validators automatically handle memory buffer objects that commonly occur with SAP HANA binary data:

```python
# Memory buffer from SAP HANA
memory_buffer = <memory at 0x10b1a2d40>

# Convert to base64 string
binary_string = validate_sap_hana_value(memory_buffer, "VARBINARY")
print(f"Converted: {binary_string}")
```

## Error Handling

The validators provide comprehensive error handling:

```python
try:
    # Invalid date format
    validate_sap_hana_value("invalid-date", "DATE")
except ValueError as e:
    print(f"Date validation error: {e}")

try:
    # Out of range TINYINT
    validate_sap_hana_value(300, "TINYINT")
except ValueError as e:
    print(f"TINYINT validation error: {e}")
```

## Integration with Existing Code

To integrate with your existing SAP HANA CDC pipeline, you can replace the generic data conversion with specific SAP HANA validators:

```python
# Before (generic conversion)
converted_row = convert_row_data(row)

# After (SAP HANA specific validation)
from moose_lib_extras import validate_sap_hana_value

def convert_sap_hana_row(row: Dict[str, Any], field_types: Dict[str, str]) -> Dict[str, Any]:
    converted_row = {}
    for field_name, value in row.items():
        sap_type = field_types.get(field_name, 'VARCHAR')  # Default to VARCHAR
        converted_row[field_name] = validate_sap_hana_value(value, sap_type)
    return converted_row
```

## Performance Considerations

- **Lazy Validation**: Validators only run when data is accessed
- **Type Caching**: Annotated types are cached for performance
- **Memory Efficient**: Binary data is converted to base64 strings for storage
- **Error Recovery**: Graceful fallback to string conversion for unknown types

## Best Practices

1. **Use Specific Types**: Use the most specific SAP HANA type for each field
2. **Handle Nulls**: All validators properly handle `None` values
3. **Validate Early**: Validate data as soon as it's received from SAP HANA
4. **Log Warnings**: Monitor logs for type conversion warnings
5. **Test Edge Cases**: Test with various data formats and edge cases

## Migration Guide

To migrate from generic string conversion to SAP HANA validators:

1. **Identify Field Types**: Map your SAP HANA table columns to appropriate types
2. **Update Models**: Replace generic types with SAP HANA annotated types
3. **Test Conversion**: Verify data conversion works correctly
4. **Handle Errors**: Add proper error handling for validation failures
5. **Monitor Performance**: Check for any performance impact

This comprehensive validator system ensures that your SAP HANA data is properly typed and validated, preventing the memory buffer issues you were experiencing while maintaining type safety and data integrity.
