from datetime import datetime

from pydantic import BaseModel

from moose_lib import (
    CdcSource,
    CdcSourceConfig,
    CdcTable,
    CdcTableConfig,
    Stream,
    moose_runtime_env,
)


class OrderRow(BaseModel):
    id: str
    customer_id: str
    total_cents: int
    status: str
    created_at: datetime


orders_cdc_source = CdcSource(
    "orders_cdc",
    CdcSourceConfig(
        kind="postgresql",
        connection=moose_runtime_env.get("TEST_CDC_CONNECTION"),
        metadata={"description": "CDC source for orders (template test)"},
    ),
)

orders_cdc_table = CdcTable[OrderRow](
    "orders",
    orders_cdc_source,
    CdcTableConfig(
        source_table="public.orders",
        primary_key=["id"],
        snapshot="initial",
        stream=True,
        table=True,
    ),
)


class OrdersIngestRow(BaseModel):
    order_id: str
    customer_id: str
    total_usd: float
    status: str
    updated_at: datetime
    op: str


orders_ingest_stream = Stream[OrdersIngestRow]("orders_ingest")


def to_orders_ingest(event):
    row = event.after or event.before
    if row is None:
        return None
    return OrdersIngestRow(
        order_id=row.id,
        customer_id=row.customer_id,
        total_usd=row.total_cents / 100,
        status=row.status,
        updated_at=row.created_at,
        op=event.op,
    )


if orders_cdc_table.changes is not None:
    orders_cdc_table.changes.add_transform(orders_ingest_stream, to_orders_ingest)
