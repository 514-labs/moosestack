# py-moose-lib-extras

A collection of extra utilities and extensions for the Moose library.

## Installation

You can install py-moose-lib-extras using pip:

```bash
pip install py-moose-lib-extras
```

## Development Installation

To install the package in development mode:

```bash
git clone https://github.com/514-labs/moosestack.git
cd moosestack/packages/py-moose-lib-extras
pip install -e .
```

For development with all optional dependencies:

```bash
pip install -e ".[dev]"
```

## Usage

### Database Metadata Generator

The package provides a powerful database metadata generator for SAP HANA databases that can extract table structure information including field names, types, and primary key information.

```python
import hdbcli.dbapi as hdb
from moose_lib_extras import (
    HanaIntrospector, 
    introspect_hana_database,
    MooseModelGenerator,
    generate_moose_models
)

# Connect to SAP HANA database
connection = hdb.connect(
    address="your-hana-server.com",
    port=30015,
    user="your_username",
    password="your_password",
    database="your_database"
)

# Method 1: Database introspection
generator = HanaIntrospector(connection)
table_names = ["USERS", "ORDERS", "PRODUCTS"]
metadata_list = generator.get_table_metadata(table_names, schema_name="YOUR_SCHEMA")

# Method 2: Generate Moose models from metadata
generate_moose_models(metadata_list, "generated_models.py")

# Method 3: Using the class-based approach for more control
model_generator = MooseModelGenerator()
model_generator.generate_models(metadata_list, "custom_models.py")
```

## Features

- **Database Metadata Generator**: Extract comprehensive table metadata from SAP HANA databases
  - Field names, data types, and constraints
  - Primary key identification
  - Nullable field information
  - Field length and scale
  - Default values
- **Moose Model Generator**: Automatically generate Python models and pipelines from database metadata
  - Converts SAP HANA data types to Python types
  - Generates BaseModel classes with proper type hints
  - Creates OlapTable instances
  - Handles primary keys, optional fields, and timestamps
  - Customizable table model generation based on table patterns
- **Type Safety**: Full type hints and dataclass support
- **Error Handling**: Robust error handling with informative messages
- **Flexible Usage**: Both class-based and function-based APIs

## Requirements

- Python 3.8+
- hdbcli>=2.20.0 (for SAP HANA database connectivity)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Changelog

### 0.1.0 (2024-01-01)

- Initial release
