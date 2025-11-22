"""Tests for OlapTable with MooseModel integration"""

from moose_lib.dmv2 import OlapTable, OlapConfig, MooseModel
from moose_lib.data_models import Column


def test_olaptable_works_with_moosemodel():
    """OlapTable should accept MooseModel types"""

    class User(MooseModel):
        user_id: int
        email: str

    table = OlapTable[User]("users", OlapConfig())

    assert table.name == "users"
    assert table.model_type == User


def test_olaptable_moosemodel_direct_column_access():
    """OlapTable with MooseModel should enable direct column access via model"""

    class Product(MooseModel):
        product_id: int
        name: str
        price: float

    table = OlapTable[Product]("products")

    # Access columns through the model class
    assert isinstance(Product.product_id, Column)
    assert Product.product_id.name == "product_id"

    # Should work in f-strings
    query = f"SELECT {Product.product_id:col}, {Product.name:col} FROM {table.name}"
    assert query == "SELECT `product_id`, `name` FROM products"


def test_olaptable_moosemodel_cols_backward_compat():
    """OlapTable with MooseModel should maintain .cols backward compatibility"""

    class Order(MooseModel):
        order_id: int
        total: float

    table = OlapTable[Order]("orders")

    # OLD pattern still works
    assert hasattr(Order, "cols")
    assert isinstance(Order.cols.order_id, Column)

    # Can use in queries
    query = f"SELECT {Order.cols.order_id} FROM orders"
    assert "`order_id`" in query


def test_olaptable_with_basemodel_still_works():
    """OlapTable should still work with regular BaseModel (backward compat)"""

    from pydantic import BaseModel

    class LegacyModel(BaseModel):
        legacy_id: int
        legacy_name: str

    # Should not crash
    table = OlapTable[LegacyModel]("legacy")

    # Old .cols pattern should still work
    assert hasattr(table, "cols")

    # Note: LegacyModel.legacy_id won't be a Column (no metaclass)
    # This is expected - only MooseModel gets the new feature


def test_olaptable_model_property():
    """OlapTable should provide access to the model class"""

    class Analytics(MooseModel):
        event_id: int
        timestamp: str

    table = OlapTable[Analytics]("analytics")

    # Should be able to access model type
    assert table.model_type == Analytics

    # Can use for column access
    assert isinstance(table.model_type.event_id, Column)
