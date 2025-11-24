"""Tests for MooseModel base class with column descriptors"""

from pydantic import BaseModel
from moose_lib.dmv2.moose_model import MooseModel
from moose_lib.data_models import Column


def test_moosemodel_inherits_from_basemodel():
    """MooseModel should be a valid Pydantic BaseModel"""

    class User(MooseModel):
        user_id: int
        email: str

    # Should work as normal Pydantic model
    instance = User(user_id=123, email="test@example.com")
    assert instance.user_id == 123
    assert instance.email == "test@example.com"


def test_moosemodel_adds_column_descriptors():
    """MooseModel metaclass should add Column descriptors for each field"""

    class User(MooseModel):
        user_id: int
        email: str
        age: int

    # Check Column descriptors exist at class level
    assert hasattr(User, "user_id")
    assert isinstance(User.user_id, Column)
    assert User.user_id.name == "user_id"

    assert hasattr(User, "email")
    assert isinstance(User.email, Column)
    assert User.email.name == "email"

    assert hasattr(User, "age")
    assert isinstance(User.age, Column)
    assert User.age.name == "age"


def test_moosemodel_column_format_spec():
    """Column descriptors should support format specs"""

    class Product(MooseModel):
        product_id: int
        product_name: str

    # Test format spec
    result = f"{Product.product_id:col}"
    assert result == "`product_id`"

    result = f"{Product.product_name:c}"
    assert result == "`product_name`"


def test_moosemodel_adds_cols_property():
    """MooseModel should add .cols property for backward compatibility"""

    class Order(MooseModel):
        order_id: int
        total: float

    # Check .cols property exists
    assert hasattr(Order, "cols")
    assert hasattr(Order.cols, "order_id")
    assert hasattr(Order.cols, "total")

    # Verify .cols.field returns Column
    assert isinstance(Order.cols.order_id, Column)
    assert Order.cols.order_id.name == "order_id"


def test_moosemodel_instance_attributes_separate():
    """Instance attributes should be separate from class Column descriptors"""

    class User(MooseModel):
        user_id: int
        email: str

    # Class level: Column objects
    assert isinstance(User.user_id, Column)

    # Instance level: actual values
    instance = User(user_id=456, email="user@test.com")
    assert instance.user_id == 456
    assert isinstance(instance.user_id, int)
    assert instance.email == "user@test.com"


def test_moosemodel_backward_compatible_with_basemodel():
    """MooseModel should be usable wherever BaseModel is expected"""

    class User(MooseModel):
        user_id: int
        email: str

    # Check it's a BaseModel subclass
    assert issubclass(User, BaseModel)

    # Check Pydantic features work
    assert hasattr(User, "model_fields")
    assert hasattr(User, "model_validate")
    assert hasattr(User, "model_dump")

    instance = User(user_id=789, email="another@test.com")
    dumped = instance.model_dump()
    assert dumped == {"user_id": 789, "email": "another@test.com"}


def test_moosemodel_empty_model():
    """MooseModel should handle models with no fields"""

    class EmptyModel(MooseModel):
        pass

    # Should not crash
    instance = EmptyModel()
    assert instance is not None


def test_moosemodel_cols_bracket_access():
    """MooseModel.cols should support bracket notation"""

    class User(MooseModel):
        user_id: int
        email: str

    # Bracket access
    col = User.cols["user_id"]
    assert isinstance(col, Column)
    assert col.name == "user_id"

    col2 = User.cols["email"]
    assert col2.name == "email"


def test_moosemodel_in_sql_fstring():
    """MooseModel columns should work in SQL f-strings"""

    class Analytics(MooseModel):
        event_id: int
        timestamp: str
        value: float

    # Test complete SQL construction
    query = f"SELECT {Analytics.event_id:col}, {Analytics.timestamp:col}, {Analytics.value:col} FROM analytics WHERE {Analytics.event_id:col} > 100"

    expected = (
        "SELECT `event_id`, `timestamp`, `value` FROM analytics WHERE `event_id` > 100"
    )
    assert query == expected
