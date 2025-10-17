"""
Moose Data Model v2 (dmv2)

This package provides the Python classes for defining Moose v2 data model resources.
"""

from .types import (
    BaseTypedResource,
    TypedMooseResource,
    Columns,
    T,
    U,
    T_none,
    U_none,
    ZeroOrMany,
)

from .olap_table import (
    OlapConfig,
    OlapTable,
    InsertOptions,
)

from .stream import (
    StreamConfig,
    TransformConfig,
    ConsumerConfig,
    Stream,
    DeadLetterModel,
    DeadLetterQueue,
    SubjectLatest,
    SubjectVersion,
    SchemaById,
    KafkaSchemaConfig,
)

from .ingest_api import (
    IngestConfig,
    IngestConfigWithDestination,
    IngestApi,
)

from .ingest_pipeline import (
    IngestPipelineConfig,
    IngestPipeline,
)

from .consumption import (
    ApiConfig,
    Api,
    get_moose_base_url,
    set_moose_base_url,
    # Backward compatibility aliases
    ConsumptionApi,
    EgressConfig,
)

from .sql_resource import (
    SqlResource,
)

from .view import (
    View,
)

from .materialized_view import (
    MaterializedViewOptions,
    MaterializedView,
)

from .workflow import (
    TaskContext,
    TaskConfig,
    Task,
    WorkflowConfig,
    Workflow,
)

from .life_cycle import (
    LifeCycle,
)

from .web_app import (
    WebApp,
    WebAppConfig,
    WebAppMetadata,
)

from .web_app_helpers import (
    ApiUtil,
    get_moose_utils,
    get_moose_dependency,
)

from .registry import (
    get_tables,
    get_table,
    get_streams,
    get_stream,
    get_ingest_apis,
    get_ingest_api,
    get_apis,
    get_api,
    get_sql_resources,
    get_sql_resource,
    get_workflows,
    get_workflow,
    get_web_apps,
    get_web_app,
    # Backward compatibility aliases
    get_consumption_apis,
    get_consumption_api,
)

__all__ = [
    # Types
    'BaseTypedResource',
    'TypedMooseResource',
    'Columns',
    'T',
    'U',
    'T_none',
    'U_none',
    'ZeroOrMany',

    # OLAP Tables
    'OlapConfig',
    'OlapTable',
    'InsertOptions',

    # Streams
    'StreamConfig',
    'TransformConfig',
    'ConsumerConfig',
    'Stream',
    'DeadLetterModel',
    'DeadLetterQueue',
    'SubjectLatest',
    'SubjectVersion',
    'SchemaById',
    'KafkaSchemaConfig',

    # Ingestion
    'IngestConfig',
    'IngestConfigWithDestination',
    'IngestPipelineConfig',
    'IngestApi',
    'IngestPipeline',

    # Consumption
    'ApiConfig',
    'Api',
    'get_moose_base_url',
    'set_moose_base_url',
    # Backward compatibility aliases (deprecated)
    'ConsumptionApi',
    'EgressConfig',

    # SQL
    'SqlResource',
    'View',
    'MaterializedViewOptions',
    'MaterializedView',

    # Workflow
    'TaskContext',
    'TaskConfig',
    'Task',
    'WorkflowConfig',
    'Workflow',

    # Lifecycle
    'LifeCycle',

    # WebApp
    'WebApp',
    'WebAppConfig',
    'WebAppMetadata',
    'ApiUtil',
    'get_moose_utils',
    'get_moose_dependency',

    # Registry
    'get_tables',
    'get_table',
    'get_streams',
    'get_stream',
    'get_ingest_apis',
    'get_ingest_api',
    'get_apis',
    'get_api',
    'get_sql_resources',
    'get_sql_resource',
    'get_workflows',
    'get_workflow',
    'get_web_apps',
    'get_web_app',
    # Backward compatibility aliases (deprecated)
    'get_consumption_apis',
    'get_consumption_api',
]
