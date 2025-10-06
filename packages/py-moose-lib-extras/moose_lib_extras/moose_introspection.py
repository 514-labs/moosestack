"""
Moose introspection utilities for discovering and analyzing BaseModel classes.

This module provides functionality to introspect Python modules and discover
classes that extend Pydantic's BaseModel, along with their field definitions.
"""

import inspect
import sys
from typing import Dict, List, Any, Type, Optional
from pydantic import BaseModel
from pydantic.fields import FieldInfo


class ModelFieldInfo:
    """Information about a single field in a BaseModel class."""
    
    def __init__(self, name: str, field_type: str, is_optional: bool = False, 
                 default_value: Any = None, alias: Optional[str] = None):
        self.name = name
        self.field_type = field_type
        self.is_optional = is_optional
        self.default_value = default_value
        self.alias = alias
    
    def __repr__(self) -> str:
        return (f"ModelFieldInfo(name='{self.name}', field_type='{self.field_type}', "
                f"is_optional={self.is_optional}, default_value={self.default_value}, "
                f"alias={self.alias})")


class ModelInfo:
    """Information about a BaseModel class and its fields."""
    
    def __init__(self, class_name: str, module_name: str, fields: List[ModelFieldInfo]):
        self.class_name = class_name
        self.module_name = module_name
        self.fields = fields
    
    def __repr__(self) -> str:
        return (f"ModelInfo(class_name='{self.class_name}', module_name='{self.module_name}', "
                f"fields={len(self.fields)})")


def get_basemodel_classes(module_or_package) -> List[ModelInfo]:
    """
    Discover all classes that extend BaseModel in a module or package.
    
    Args:
        module_or_package: A Python module or package to introspect
        
    Returns:
        List of ModelInfo objects containing class and field information
    """
    model_infos = []
    
    # Get all members of the module/package
    members = inspect.getmembers(module_or_package, inspect.isclass)
    
    for name, obj in members:
        # Check if the class extends BaseModel
        if issubclass(obj, BaseModel) and obj is not BaseModel:
            # Extract field information
            fields = _extract_field_info(obj)
            
            # Get module name
            module_name = getattr(obj, '__module__', 'unknown')
            
            model_info = ModelInfo(
                class_name=name,
                module_name=module_name,
                fields=fields
            )
            model_infos.append(model_info)
    
    return model_infos


def _extract_field_info(model_class: Type[BaseModel]) -> List[ModelFieldInfo]:
    """
    Extract field information from a BaseModel class.
    
    Args:
        model_class: A BaseModel class to introspect
        
    Returns:
        List of ModelFieldInfo objects
    """
    fields = []
    
    # Get the model fields from Pydantic
    model_fields = model_class.model_fields
    
    for field_name, field_info in model_fields.items():
        # Get the field type annotation
        field_type = _get_field_type_string(field_info)
        
        # Check if the field is optional
        is_optional = _is_optional_field(field_info)
        
        # Get default value
        default_value = _get_default_value(field_info)
        
        # Get alias if it exists
        alias = getattr(field_info, 'alias', None)
        
        field = ModelFieldInfo(
            name=field_name,
            field_type=field_type,
            is_optional=is_optional,
            default_value=default_value,
            alias=alias
        )
        fields.append(field)
    
    return fields


def _get_field_type_string(field_info: FieldInfo) -> str:
    """Convert field type annotation to string representation."""
    annotation = field_info.annotation
    
    if annotation is None:
        return "Any"
    
    # Handle Union types (including Optional)
    if hasattr(annotation, '__origin__') and annotation.__origin__ is type(None).__class__:
        # This is a Union type
        args = getattr(annotation, '__args__', ())
        if len(args) == 2 and type(None) in args:
            # This is Optional[SomeType]
            non_none_type = args[0] if args[1] is type(None) else args[1]
            return f"Optional[{_type_to_string(non_none_type)}]"
        else:
            # Regular Union type
            type_strings = [_type_to_string(arg) for arg in args]
            return f"Union[{', '.join(type_strings)}]"
    
    return _type_to_string(annotation)


def _type_to_string(type_obj) -> str:
    """Convert a type object to its string representation."""
    if hasattr(type_obj, '__name__'):
        return type_obj.__name__
    elif hasattr(type_obj, '__origin__'):
        # Handle generic types
        origin = type_obj.__origin__
        args = getattr(type_obj, '__args__', ())
        if args:
            arg_strings = [_type_to_string(arg) for arg in args]
            return f"{origin.__name__}[{', '.join(arg_strings)}]"
        else:
            return origin.__name__
    else:
        return str(type_obj)


def _is_optional_field(field_info: FieldInfo) -> bool:
    """Check if a field is optional (can be None)."""
    annotation = field_info.annotation
    
    if annotation is None:
        return True
    
    # Check if it's Optional[SomeType] or Union[SomeType, None]
    if hasattr(annotation, '__origin__'):
        args = getattr(annotation, '__args__', ())
        return type(None) in args
    
    return False


def _get_default_value(field_info: FieldInfo) -> Any:
    """Get the default value for a field."""
    if hasattr(field_info, 'default'):
        return field_info.default
    elif hasattr(field_info, 'default_factory'):
        return f"<factory: {field_info.default_factory}>"
    else:
        return None


def introspect_module(module_name: str) -> List[ModelInfo]:
    """
    Introspect a module by name and return all BaseModel classes.
    
    Args:
        module_name: Name of the module to introspect
        
    Returns:
        List of ModelInfo objects
    """
    try:
        module = sys.modules[module_name]
        return get_basemodel_classes(module)
    except KeyError:
        # Module not loaded, try to import it
        try:
            module = __import__(module_name)
            return get_basemodel_classes(module)
        except ImportError as e:
            raise ImportError(f"Could not import module '{module_name}': {e}")


def print_model_info(model_infos: List[ModelInfo]) -> None:
    """
    Print model information in a readable format.
    
    Args:
        model_infos: List of ModelInfo objects to print
    """
    for model_info in model_infos:
        print(f"\nClass: {model_info.class_name}")
        print(f"Module: {model_info.module_name}")
        print("Fields:")
        
        for field in model_info.fields:
            optional_str = " (optional)" if field.is_optional else ""
            alias_str = f" (alias: {field.alias})" if field.alias else ""
            default_str = f" (default: {field.default_value})" if field.default_value is not None else ""
            
            print(f"  - {field.name}: {field.field_type}{optional_str}{alias_str}{default_str}")