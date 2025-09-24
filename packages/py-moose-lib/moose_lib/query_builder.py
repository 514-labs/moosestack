from datetime import datetime
from typing import Callable, Literal

import sqlglot as sg
import sqlglot.expressions as sge
from pydantic import BaseModel

from .data_models import Column, Key
from .dmv2 import OlapTable, IngestPipeline, IngestPipelineConfig
from moose_lib.utilities.sql import clickhouse_param_type_for_value


class Params:
    def __init__(self):
        self._counter = 0
        self.bindings: dict[str, object] = {}

    def bind(self, value: object, name: str | None = None, ch_type: str | None = None) -> sge.Expression:
        if name is None:
            name = f"p{self._counter}"
            self._counter += 1

        if ch_type is None:
            ch_type = clickhouse_param_type_for_value(value)

        expr = sg.parse_one(f"{{{name}: {ch_type}}}", dialect="clickhouse")
        self.bindings[name] = value
        return expr


def to_column(col: Column, table_name: str | None = None) -> sge.Column:
    col_name = getattr(col, "name")
    table_ident = None
    if table_name is not None:
        table_ident = sge.Identifier(this=table_name, quoted=True)
    elif hasattr(col, "table_name") and getattr(col, "table_name"):
        table_ident = sge.Identifier(this=getattr(col, "table_name"), quoted=True)

    return sge.Column(
        this=sge.Identifier(this=col_name, quoted=True),
        table=table_ident,
    )


type Predicate = Callable[["Query"], sge.Expression]

# Order-by type annotations
type OrderDirection = Literal["asc", "desc"]
type OrderExpr = sge.Expression | Column | "ColumnRef"
type OrderItem = OrderExpr | tuple[OrderExpr, OrderDirection]


class ColumnRef:
    def __init__(self, column: Column):
        self._column = column

    def _binary_op(self, op_name: str, value: object) -> Predicate:
        def resolve(query: "Query") -> sge.Expression:
            table_name = query._from_table.name if query._from_table is not None else None
            left = to_column(self._column, table_name)
            right = query.params.bind(value)
            op = getattr(left, op_name)
            return op(right)

        return resolve

    def eq(self, value: object) -> Predicate:
        return self._binary_op("eq", value)

    def ne(self, value: object) -> Predicate:
        return self._binary_op("neq", value)

    def lt(self, value: object) -> Predicate:
        return self._binary_op("__lt__", value)

    def le(self, value: object) -> Predicate:
        return self._binary_op("__le__", value)

    def gt(self, value: object) -> Predicate:
        return self._binary_op("__gt__", value)

    def ge(self, value: object) -> Predicate:
        return self._binary_op("__ge__", value)

    def in_(self, values: list[object]) -> Predicate:
        def resolve(query: "Query") -> sge.Expression:
            table_name = query._from_table.name if query._from_table is not None else None
            left = to_column(self._column, table_name)
            rights = [query.params.bind(v) for v in values]
            return left.isin(*rights)

        return resolve

    def is_null(self) -> Predicate:
        def resolve(query: "Query") -> sge.Expression:
            table_name = query._from_table.name if query._from_table is not None else None
            left = to_column(self._column, table_name)
            return left.is_(sge.Null())

        return resolve


def col(column: Column) -> ColumnRef:
    return ColumnRef(column)


class Query:
    def __init__(self):
        self.params = Params()
        self.inner: sge.Select = sge.Select()
        self._from_table: OlapTable | None = None

    def from_(self, table: OlapTable) -> "Query":
        self._from_table = table
        self.inner = self.inner.from_(table.name)
        return self

    def select(self, *cols: Column) -> "Query":
        sge_cols = [to_column(c, self._from_table.name if self._from_table is not None else None) for c in cols]
        self.inner = self.inner.select(*sge_cols)
        return self

    def where(self, predicate_or_expr) -> "Query":
        if callable(predicate_or_expr):
            expr = predicate_or_expr(self)
        else:
            expr = predicate_or_expr
        self.inner = self.inner.where(expr)
        return self

    def order_by(self, *items: OrderItem) -> "Query":
        orders: list[sge.Expression] = []
        table_name = self._from_table.name if self._from_table is not None else None

        for item in items:
            desc = False
            expr: sge.Expression

            if isinstance(item, tuple) and len(item) == 2:
                col_like, direction = item
                if isinstance(direction, str):
                    desc = direction.lower() == "desc"
                else:
                    raise ValueError("order_by direction must be 'asc' or 'desc'")
                if isinstance(col_like, Column):
                    expr = to_column(col_like, table_name)
                elif isinstance(col_like, ColumnRef):
                    expr = to_column(col_like._column, table_name)
                else:
                    expr = col_like
            else:
                if isinstance(item, Column):
                    expr = to_column(item, table_name)
                elif isinstance(item, ColumnRef):
                    expr = to_column(item._column, table_name)
                else:
                    expr = item

            orders.append(sge.Ordered(this=expr, desc=desc))

        self.inner = self.inner.order_by(*orders)
        return self

    def to_sql(self) -> str:
        return self.inner.sql(dialect="clickhouse")

    def to_sql_and_params(self) -> tuple[str, dict[str, object]]:
        return self.to_sql(), dict(self.params.bindings)

    def limit(self, n: int) -> "Query":
        self.inner = self.inner.limit(n)
        return self


def and_(*predicates_or_exprs) -> Predicate:
    def resolve(query: "Query") -> sge.Expression:
        exprs = [p(query) if callable(p) else p for p in predicates_or_exprs]
        if not exprs:
            raise ValueError("and_ requires at least one predicate")
        combined = exprs[0]
        for e in exprs[1:]:
            combined = combined.and_(e)
        return combined

    return resolve


def or_(*predicates_or_exprs) -> Predicate:
    def resolve(query: "Query") -> sge.Expression:
        exprs = [p(query) if callable(p) else p for p in predicates_or_exprs]
        if not exprs:
            raise ValueError("or_ requires at least one predicate")
        combined = exprs[0]
        for e in exprs[1:]:
            combined = combined.or_(e)
        return combined

    return resolve
