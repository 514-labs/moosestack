import datetime
from pydantic import BaseModel

from moose_lib import simple_aggregated, Key
from moose_lib.data_models import SimpleAggregateFunction, _to_columns


def test_simple_aggregated_helper():
    """Test that simple_aggregated helper creates correct annotation"""
    annotated_type = simple_aggregated('sum', int)

    # Check that it's annotated
    assert hasattr(annotated_type, '__metadata__')
    metadata = annotated_type.__metadata__[0]

    # Check metadata is SimpleAggregateFunction instance
    assert isinstance(metadata, SimpleAggregateFunction)
    assert metadata.agg_func == 'sum'
    assert metadata.arg_type == int


def test_simple_aggregate_function_to_dict():
    """Test that SimpleAggregateFunction.to_dict() creates correct structure"""
    func = SimpleAggregateFunction(agg_func='sum', arg_type=int)
    result = func.to_dict()

    assert result['functionName'] == 'sum'
    assert 'argumentType' in result
    # Python int maps to "Int" by default (not "Int64")
    assert result['argumentType'] == 'Int'


def test_simple_aggregate_function_to_dict_with_different_types():
    """Test SimpleAggregateFunction.to_dict() with various types"""
    # Test with float
    func_float = SimpleAggregateFunction(agg_func='max', arg_type=float)
    result_float = func_float.to_dict()
    assert result_float['functionName'] == 'max'
    assert result_float['argumentType'] == 'Float64'

    # Test with str
    func_str = SimpleAggregateFunction(agg_func='anyLast', arg_type=str)
    result_str = func_str.to_dict()
    assert result_str['functionName'] == 'anyLast'
    assert result_str['argumentType'] == 'String'


def test_dataclass_with_simple_aggregated():
    """Test that BaseModel with simple_aggregated field converts correctly"""
    class TestModel(BaseModel):
        date_stamp: Key[datetime.datetime]
        table_name: Key[str]
        row_count: simple_aggregated('sum', int)

    columns = _to_columns(TestModel)

    # Find the row_count column
    row_count_col = next(c for c in columns if c.name == 'row_count')

    # Check basic type - Python int maps to "Int"
    assert row_count_col.data_type == 'Int'

    # Check annotation
    simple_agg_annotation = next(
        (a for a in row_count_col.annotations if a[0] == 'simpleAggregationFunction'),
        None
    )
    assert simple_agg_annotation is not None
    assert simple_agg_annotation[1]['functionName'] == 'sum'
    assert simple_agg_annotation[1]['argumentType'] == 'Int'


def test_multiple_simple_aggregated_fields():
    """Test BaseModel with multiple SimpleAggregateFunction fields"""
    class StatsModel(BaseModel):
        timestamp: Key[datetime.datetime]
        total_count: simple_aggregated('sum', int)
        max_value: simple_aggregated('max', int)
        min_value: simple_aggregated('min', int)
        last_seen: simple_aggregated('anyLast', datetime.datetime)

    columns = _to_columns(StatsModel)

    # Test sum
    sum_col = next(c for c in columns if c.name == 'total_count')
    sum_annotation = next(
        a for a in sum_col.annotations if a[0] == 'simpleAggregationFunction'
    )
    assert sum_annotation[1]['functionName'] == 'sum'

    # Test max
    max_col = next(c for c in columns if c.name == 'max_value')
    max_annotation = next(
        a for a in max_col.annotations if a[0] == 'simpleAggregationFunction'
    )
    assert max_annotation[1]['functionName'] == 'max'

    # Test min
    min_col = next(c for c in columns if c.name == 'min_value')
    min_annotation = next(
        a for a in min_col.annotations if a[0] == 'simpleAggregationFunction'
    )
    assert min_annotation[1]['functionName'] == 'min'

    # Test anyLast with datetime
    last_col = next(c for c in columns if c.name == 'last_seen')
    assert last_col.data_type == 'DateTime'
    last_annotation = next(
        a for a in last_col.annotations if a[0] == 'simpleAggregationFunction'
    )
    assert last_annotation[1]['functionName'] == 'anyLast'
    assert last_annotation[1]['argumentType'] == 'DateTime'
