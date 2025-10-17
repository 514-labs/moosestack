"""
SAP HANA Data Type Validators and Custom Annotated Types.

This module provides reusable validator functions and custom annotated types
for all SAP HANA data types, ensuring proper type conversion and validation
instead of casting everything to strings.
"""

import base64
import logging
from datetime import datetime, date, time, timedelta
from decimal import Decimal
from typing import Any, Union, Annotated, get_args, get_origin
from pydantic import GetCoreSchemaHandler, GetJsonSchemaHandler
from pydantic_core import core_schema
from pydantic.json_schema import JsonSchemaValue

logger = logging.getLogger(__name__)


# ============================================================================
# DATETIME TYPES VALIDATORS
# ============================================================================

def validate_sap_date(value: Any) -> date:
    """Validate and convert SAP HANA DATE type."""
    if value is None:
        return None
    
    if isinstance(value, date):
        return value
    
    if isinstance(value, datetime):
        return value.date()
    
    if isinstance(value, str):
        try:
            # Try parsing common date formats
            if 'T' in value:
                return datetime.fromisoformat(value).date()
            else:
                return datetime.strptime(value, '%Y-%m-%d').date()
        except ValueError:
            logger.warning(f"Failed to parse date string: {value}")
            raise ValueError(f"Invalid date format: {value}")
    
    raise ValueError(f"Cannot convert {type(value)} to date")


def validate_sap_time(value: Any) -> time:
    """Validate and convert SAP HANA TIME type."""
    if value is None:
        return None
    
    if isinstance(value, time):
        return value
    
    if isinstance(value, datetime):
        return value.time()
    
    if isinstance(value, str):
        try:
            # Try parsing common time formats
            if 'T' in value:
                return datetime.fromisoformat(value).time()
            else:
                return datetime.strptime(value, '%H:%M:%S').time()
        except ValueError:
            logger.warning(f"Failed to parse time string: {value}")
            raise ValueError(f"Invalid time format: {value}")
    
    raise ValueError(f"Cannot convert {type(value)} to time")


def validate_sap_seconddate(value: Any) -> datetime:
    """Validate and convert SAP HANA SECONDDATE type (timestamp with seconds precision)."""
    if value is None:
        return None
    
    if isinstance(value, datetime):
        return value
    
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            logger.warning(f"Failed to parse seconddate string: {value}")
            raise ValueError(f"Invalid seconddate format: {value}")
    
    raise ValueError(f"Cannot convert {type(value)} to datetime")


def validate_sap_timestamp(value: Any) -> datetime:
    """Validate and convert SAP HANA TIMESTAMP type."""
    if value is None:
        return None
    
    if isinstance(value, datetime):
        return value
    
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            logger.warning(f"Failed to parse timestamp string: {value}")
            raise ValueError(f"Invalid timestamp format: {value}")
    
    raise ValueError(f"Cannot convert {type(value)} to datetime")


# ============================================================================
# NUMERIC TYPES VALIDATORS
# ============================================================================

def validate_sap_tinyint(value: Any) -> int:
    """Validate and convert SAP HANA TINYINT type (0-255)."""
    if value is None:
        return None
    
    try:
        int_val = int(value)
        if not (0 <= int_val <= 255):
            raise ValueError(f"TINYINT value {int_val} out of range (0-255)")
        return int_val
    except (ValueError, TypeError):
        raise ValueError(f"Cannot convert {type(value)} to TINYINT")


def validate_sap_smallint(value: Any) -> int:
    """Validate and convert SAP HANA SMALLINT type (-32768 to 32767)."""
    if value is None:
        return None
    
    try:
        int_val = int(value)
        if not (-32768 <= int_val <= 32767):
            raise ValueError(f"SMALLINT value {int_val} out of range (-32768 to 32767)")
        return int_val
    except (ValueError, TypeError):
        raise ValueError(f"Cannot convert {type(value)} to SMALLINT")


def validate_sap_integer(value: Any) -> int:
    """Validate and convert SAP HANA INTEGER type (-2147483648 to 2147483647)."""
    if value is None:
        return None
    
    try:
        int_val = int(value)
        if not (-2147483648 <= int_val <= 2147483647):
            raise ValueError(f"INTEGER value {int_val} out of range (-2147483648 to 2147483647)")
        return int_val
    except (ValueError, TypeError):
        raise ValueError(f"Cannot convert {type(value)} to INTEGER")


def validate_sap_bigint(value: Any) -> int:
    """Validate and convert SAP HANA BIGINT type."""
    if value is None:
        return None
    
    try:
        return int(value)
    except (ValueError, TypeError):
        raise ValueError(f"Cannot convert {type(value)} to BIGINT")


def validate_sap_smalldecimal(value: Any) -> Decimal:
    """Validate and convert SAP HANA SMALLDECIMAL type with ClickHouse compatibility."""
    if value is None:
        return None
    
    if isinstance(value, Decimal):
        decimal_val = value
    else:
        try:
            decimal_val = Decimal(str(value))
        except (ValueError, TypeError):
            raise ValueError(f"Cannot convert {type(value)} to SMALLDECIMAL")
    
    # SMALLDECIMAL typically has lower precision than DECIMAL
    # Limit to 8 digits total precision for ClickHouse compatibility
    decimal_str = str(decimal_val)
    
    # Remove decimal point and count digits
    if '.' in decimal_str:
        integer_part, decimal_part = decimal_str.split('.')
        total_digits = len(integer_part) + len(decimal_part)
    else:
        total_digits = len(decimal_str)
    
    # If precision is too high, round to fit ClickHouse limits
    if total_digits > 8:
        # Calculate how many decimal places to keep
        if '.' in decimal_str:
            integer_part, decimal_part = decimal_str.split('.')
            integer_digits = len(integer_part)
            max_decimal_places = max(0, 8 - integer_digits)
            
            # Round to the maximum allowed decimal places
            if max_decimal_places > 0:
                decimal_val = decimal_val.quantize(Decimal('0.' + '0' * max_decimal_places))
            else:
                # No decimal places allowed, round to nearest integer
                decimal_val = decimal_val.quantize(Decimal('1'))
        else:
            # If it's a whole number with too many digits, truncate
            decimal_val = Decimal(str(decimal_val)[:8])
        
        # Double-check that we didn't create a number with too many digits due to rounding
        final_str = str(decimal_val)
        final_digits = len(final_str.replace('.', ''))
        if final_digits > 8:
            # If rounding created more digits, truncate to 8 digits
            if '.' in final_str:
                integer_part, decimal_part = final_str.split('.')
                if len(integer_part) >= 8:
                    decimal_val = Decimal(integer_part[:8])
                else:
                    max_decimal = 8 - len(integer_part)
                    decimal_val = Decimal(integer_part + '.' + decimal_part[:max_decimal])
            else:
                decimal_val = Decimal(final_str[:8])
    
    return decimal_val


def validate_sap_decimal(value: Any) -> Decimal:
    """Validate and convert SAP HANA DECIMAL type with ClickHouse compatibility."""
    if value is None:
        return None
    
    if isinstance(value, Decimal):
        decimal_val = value
    else:
        try:
            decimal_val = Decimal(str(value))
        except (ValueError, TypeError):
            raise ValueError(f"Cannot convert {type(value)} to DECIMAL")
    
    # ClickHouse Decimal32/64/128 have precision limits
    # We'll limit to 10 digits total precision to be safe
    # This handles most SAP HANA decimal values while being ClickHouse compatible
    decimal_str = str(decimal_val)
    
    # Remove decimal point and count digits
    if '.' in decimal_str:
        integer_part, decimal_part = decimal_str.split('.')
        total_digits = len(integer_part) + len(decimal_part)
    else:
        total_digits = len(decimal_str)
    
    # If precision is too high, round to fit ClickHouse limits
    if total_digits > 10:
        # Calculate how many decimal places to keep
        if '.' in decimal_str:
            integer_part, decimal_part = decimal_str.split('.')
            integer_digits = len(integer_part)
            max_decimal_places = max(0, 10 - integer_digits)
            
            # Round to the maximum allowed decimal places
            if max_decimal_places > 0:
                decimal_val = decimal_val.quantize(Decimal('0.' + '0' * max_decimal_places))
            else:
                # No decimal places allowed, round to nearest integer
                decimal_val = decimal_val.quantize(Decimal('1'))
        else:
            # If it's a whole number with too many digits, truncate
            decimal_val = Decimal(str(decimal_val)[:10])
        
        # Double-check that we didn't create a number with too many digits due to rounding
        final_str = str(decimal_val)
        final_digits = len(final_str.replace('.', ''))
        if final_digits > 10:
            # If rounding created more digits, truncate to 10 digits
            if '.' in final_str:
                integer_part, decimal_part = final_str.split('.')
                if len(integer_part) >= 10:
                    decimal_val = Decimal(integer_part[:10])
                else:
                    max_decimal = 10 - len(integer_part)
                    decimal_val = Decimal(integer_part + '.' + decimal_part[:max_decimal])
            else:
                decimal_val = Decimal(final_str[:10])
    
    return decimal_val


def validate_sap_real(value: Any) -> float:
    """Validate and convert SAP HANA REAL type (32-bit float)."""
    if value is None:
        return None
    
    try:
        float_val = float(value)
        # Check for overflow/underflow
        if abs(float_val) > 3.4028235e38:
            raise ValueError(f"REAL value {float_val} out of range")
        return float_val
    except (ValueError, TypeError, OverflowError):
        raise ValueError(f"Cannot convert {type(value)} to REAL")


def validate_sap_double(value: Any) -> float:
    """Validate and convert SAP HANA DOUBLE type (64-bit float)."""
    if value is None:
        return None
    
    try:
        return float(value)
    except (ValueError, TypeError, OverflowError):
        raise ValueError(f"Cannot convert {type(value)} to DOUBLE")


# ============================================================================
# BOOLEAN TYPE VALIDATOR
# ============================================================================

def validate_sap_boolean(value: Any) -> bool:
    """Validate and convert SAP HANA BOOLEAN type."""
    if value is None:
        return None
    
    if isinstance(value, bool):
        return value
    
    if isinstance(value, (int, float)):
        return bool(value)
    
    if isinstance(value, str):
        lower_val = value.lower()
        if lower_val in ('true', '1', 'yes', 'on'):
            return True
        elif lower_val in ('false', '0', 'no', 'off'):
            return False
        else:
            raise ValueError(f"Cannot convert string '{value}' to BOOLEAN")
    
    raise ValueError(f"Cannot convert {type(value)} to BOOLEAN")


# ============================================================================
# CHARACTER STRING TYPES VALIDATORS
# ============================================================================

def validate_sap_varchar(value: Any) -> str:
    """Validate and convert SAP HANA VARCHAR type."""
    if value is None:
        return None
    
    return str(value)


def validate_sap_nvarchar(value: Any) -> str:
    """Validate and convert SAP HANA NVARCHAR type (Unicode string)."""
    if value is None:
        return None
    
    return str(value)


def validate_sap_alphanum(value: Any) -> str:
    """Validate and convert SAP HANA ALPHANUM type (alphanumeric string)."""
    if value is None:
        return None
    
    str_val = str(value)
    # ALPHANUM should only contain alphanumeric characters
    if not str_val.replace('_', '').isalnum():
        logger.warning(f"ALPHANUM value '{str_val}' contains non-alphanumeric characters")
    
    return str_val


def validate_sap_shorttext(value: Any) -> str:
    """Validate and convert SAP HANA SHORTTEXT type."""
    if value is None:
        return None
    
    return str(value)


# ============================================================================
# BINARY TYPES VALIDATORS
# ============================================================================

def validate_sap_varbinary(value: Any) -> str:
    """Validate and convert SAP HANA VARBINARY type to base64 string."""
    if value is None:
        return None
    
    # Handle memory buffer objects
    if hasattr(value, '__class__') and 'memory' in str(value.__class__):
        try:
            if hasattr(value, 'tobytes'):
                binary_data = value.tobytes()
            elif hasattr(value, 'read'):
                binary_data = value.read()
            else:
                binary_data = str(value).encode('utf-8')
            return base64.b64encode(binary_data).decode('utf-8')
        except Exception as e:
            logger.warning(f"Failed to convert memory buffer to base64: {e}")
            return str(value)
    
    # Handle bytes objects
    if isinstance(value, bytes):
        try:
            return base64.b64encode(value).decode('utf-8')
        except Exception as e:
            logger.warning(f"Failed to convert bytes to base64: {e}")
            return str(value)
    
    # Handle bytearray objects
    if isinstance(value, bytearray):
        try:
            return base64.b64encode(value).decode('utf-8')
        except Exception as e:
            logger.warning(f"Failed to convert bytearray to base64: {e}")
            return str(value)
    
    # Handle memoryview objects
    if isinstance(value, memoryview):
        try:
            return base64.b64encode(value.tobytes()).decode('utf-8')
        except Exception as e:
            logger.warning(f"Failed to convert memoryview to base64: {e}")
            return str(value)
    
    # Handle string representations of memory buffers
    if isinstance(value, str) and value.startswith('<memory at 0x') and value.endswith('>'):
        logger.warning(f"Found memory buffer string representation: {value}")
        return f"BINARY_DATA_{hash(value)}"
    
    # For other types, convert to string
    return str(value)


# ============================================================================
# LARGE OBJECT TYPES VALIDATORS
# ============================================================================

def validate_sap_blob(value: Any) -> str:
    """Validate and convert SAP HANA BLOB type to base64 string."""
    if value is None:
        return None
    
    return validate_sap_varbinary(value)  # Same logic as VARBINARY


def validate_sap_clob(value: Any) -> str:
    """Validate and convert SAP HANA CLOB type to string."""
    if value is None:
        return None
    
    # Handle memory buffer objects for CLOB
    if hasattr(value, '__class__') and 'memory' in str(value.__class__):
        try:
            if hasattr(value, 'read'):
                return value.read()
            else:
                return str(value)
        except Exception as e:
            logger.warning(f"Failed to read CLOB memory buffer: {e}")
            return str(value)
    
    return str(value)


def validate_sap_nclob(value: Any) -> str:
    """Validate and convert SAP HANA NCLOB type to Unicode string."""
    if value is None:
        return None
    
    # Handle memory buffer objects for NCLOB
    if hasattr(value, '__class__') and 'memory' in str(value.__class__):
        try:
            if hasattr(value, 'read'):
                return value.read()
            else:
                return str(value)
        except Exception as e:
            logger.warning(f"Failed to read NCLOB memory buffer: {e}")
            return str(value)
    
    return str(value)


def validate_sap_text(value: Any) -> str:
    """Validate and convert SAP HANA TEXT type to string."""
    if value is None:
        return None
    
    return validate_sap_clob(value)  # Same logic as CLOB


# ============================================================================
# MULTI-VALUED TYPES VALIDATORS
# ============================================================================

def validate_sap_array(value: Any) -> list:
    """Validate and convert SAP HANA ARRAY type."""
    if value is None:
        return None
    
    if isinstance(value, list):
        return value
    
    if isinstance(value, tuple):
        return list(value)
    
    # Try to parse string representation of array
    if isinstance(value, str):
        try:
            # Simple JSON-like array parsing
            import json
            return json.loads(value)
        except (ValueError, TypeError):
            logger.warning(f"Failed to parse array string: {value}")
            return [value]  # Return as single-element list
    
    # Convert other types to single-element list
    return [value]


# ============================================================================
# SPATIAL TYPES VALIDATORS
# ============================================================================

def validate_sap_st_geometry(value: Any) -> str:
    """Validate and convert SAP HANA ST_GEOMETRY type to string representation."""
    if value is None:
        return None
    
    # Spatial data is typically stored as WKT (Well-Known Text) or binary
    if isinstance(value, str):
        return value
    
    # Handle binary spatial data
    if isinstance(value, (bytes, bytearray, memoryview)):
        try:
            return base64.b64encode(value).decode('utf-8')
        except Exception as e:
            logger.warning(f"Failed to convert spatial binary data: {e}")
            return str(value)
    
    # Handle memory buffer objects
    if hasattr(value, '__class__') and 'memory' in str(value.__class__):
        try:
            if hasattr(value, 'read'):
                return value.read()
            else:
                return str(value)
        except Exception as e:
            logger.warning(f"Failed to read spatial memory buffer: {e}")
            return str(value)
    
    return str(value)


def validate_sap_st_point(value: Any) -> str:
    """Validate and convert SAP HANA ST_POINT type to string representation."""
    if value is None:
        return None
    
    return validate_sap_st_geometry(value)  # Same logic as ST_GEOMETRY


# ============================================================================
# CUSTOM ANNOTATED TYPES
# ============================================================================

# Datetime types
SapDate = Annotated[date, validate_sap_date]
SapTime = Annotated[time, validate_sap_time]
SapSecondDate = Annotated[datetime, validate_sap_seconddate]
SapTimestamp = Annotated[datetime, validate_sap_timestamp]

# Numeric types
SapTinyInt = Annotated[int, validate_sap_tinyint]
SapSmallInt = Annotated[int, validate_sap_smallint]
SapInteger = Annotated[int, validate_sap_integer]
SapBigInt = Annotated[int, validate_sap_bigint]
SapSmallDecimal = Annotated[Decimal, validate_sap_smalldecimal]
SapDecimal = Annotated[Decimal, validate_sap_decimal]
SapReal = Annotated[float, validate_sap_real]
SapDouble = Annotated[float, validate_sap_double]

# Boolean type
SapBoolean = Annotated[bool, validate_sap_boolean]

# Character string types
SapVarchar = Annotated[str, validate_sap_varchar]
SapNvarchar = Annotated[str, validate_sap_nvarchar]
SapAlphanum = Annotated[str, validate_sap_alphanum]
SapShortText = Annotated[str, validate_sap_shorttext]

# Binary types
SapVarbinary = Annotated[str, validate_sap_varbinary]

# Large Object types
SapBlob = Annotated[str, validate_sap_blob]
SapClob = Annotated[str, validate_sap_clob]
SapNclob = Annotated[str, validate_sap_nclob]
SapText = Annotated[str, validate_sap_text]

# Multi-valued types
SapArray = Annotated[list, validate_sap_array]

# Spatial types
SapStGeometry = Annotated[str, validate_sap_st_geometry]
SapStPoint = Annotated[str, validate_sap_st_point]


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def get_sap_hana_validator(sap_type: str):
    """Get the appropriate validator function for a SAP HANA data type."""
    validators = {
        # Datetime types
        'DATE': validate_sap_date,
        'TIME': validate_sap_time,
        'SECONDDATE': validate_sap_seconddate,
        'TIMESTAMP': validate_sap_timestamp,
        
        # Numeric types
        'TINYINT': validate_sap_tinyint,
        'SMALLINT': validate_sap_smallint,
        'INTEGER': validate_sap_integer,
        'BIGINT': validate_sap_bigint,
        'SMALLDECIMAL': validate_sap_smalldecimal,
        'DECIMAL': validate_sap_decimal,
        'REAL': validate_sap_real,
        'DOUBLE': validate_sap_double,
        
        # Boolean type
        'BOOLEAN': validate_sap_boolean,
        
        # Character string types
        'VARCHAR': validate_sap_varchar,
        'NVARCHAR': validate_sap_nvarchar,
        'ALPHANUM': validate_sap_alphanum,
        'SHORTTEXT': validate_sap_shorttext,
        
        # Binary types
        'VARBINARY': validate_sap_varbinary,
        
        # Large Object types
        'BLOB': validate_sap_blob,
        'CLOB': validate_sap_clob,
        'NCLOB': validate_sap_nclob,
        'TEXT': validate_sap_text,
        
        # Multi-valued types
        'ARRAY': validate_sap_array,
        
        # Spatial types
        'ST_GEOMETRY': validate_sap_st_geometry,
        'ST_POINT': validate_sap_st_point,
    }
    
    return validators.get(sap_type.upper())


def get_sap_hana_annotated_type(sap_type: str):
    """Get the appropriate annotated type for a SAP HANA data type."""
    annotated_types = {
        # Datetime types
        'DATE': SapDate,
        'TIME': SapTime,
        'SECONDDATE': SapSecondDate,
        'TIMESTAMP': SapTimestamp,
        
        # Numeric types
        'TINYINT': SapTinyInt,
        'SMALLINT': SapSmallInt,
        'INTEGER': SapInteger,
        'BIGINT': SapBigInt,
        'SMALLDECIMAL': SapSmallDecimal,
        'DECIMAL': SapDecimal,
        'REAL': SapReal,
        'DOUBLE': SapDouble,
        
        # Boolean type
        'BOOLEAN': SapBoolean,
        
        # Character string types
        'VARCHAR': SapVarchar,
        'NVARCHAR': SapNvarchar,
        'ALPHANUM': SapAlphanum,
        'SHORTTEXT': SapShortText,
        
        # Binary types
        'VARBINARY': SapVarbinary,
        
        # Large Object types
        'BLOB': SapBlob,
        'CLOB': SapClob,
        'NCLOB': SapNclob,
        'TEXT': SapText,
        
        # Multi-valued types
        'ARRAY': SapArray,
        
        # Spatial types
        'ST_GEOMETRY': SapStGeometry,
        'ST_POINT': SapStPoint,
    }
    
    return annotated_types.get(sap_type.upper())


def validate_sap_hana_value(value: Any, sap_type: str) -> Any:
    """Validate a value against a specific SAP HANA data type."""
    validator = get_sap_hana_validator(sap_type)
    if validator:
        return validator(value)
    else:
        logger.warning(f"No validator found for SAP HANA type: {sap_type}")
        return value
