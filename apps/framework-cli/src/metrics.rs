use prometheus_client::metrics::counter::Counter;
use prometheus_client::metrics::family::Family;
use prometheus_client::metrics::gauge::Gauge;
use prometheus_client::{
    encoding::{text::encode, EncodeLabelSet},
    metrics::histogram::Histogram,
    registry::Registry,
};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

use crate::infrastructure::redis::redis_client::RedisClient;
use crate::metrics_inserter::MetricsInserter;
use crate::utilities::decode_object;
use chrono::{DateTime, Utc};
use tracing::trace;

pub const TOTAL_LATENCY: &str = "moose_total_latency";
pub const LATENCY: &str = "moose_latency";
pub const INGESTED_BYTES: &str = "moose_ingested_bytes";
pub const CONSUMED_BYTES: &str = "moose_consumed_bytes";
pub const HTTP_TO_TOPIC_EVENT_COUNT: &str = "moose_http_to_topic_event_count";
pub const TOPIC_TO_OLAP_EVENT_COUNT: &str = "moose_topic_to_olap_event_count";
pub const TOPIC_TO_OLAP_BYTE_COUNT: &str = "moose_topic_to_olap_bytes_count";
pub const STREAMING_FUNCTION_EVENT_INPUT_COUNT: &str =
    "moose_streaming_functions_events_input_count";
pub const STREAMING_FUNCTION_EVENT_OUPUT_COUNT: &str =
    "moose_streaming_functions_events_output_count";
pub const STREAMING_FUNCTION_PROCESSED_BYTE_COUNT: &str =
    "moose_streaming_functions_processed_byte_count";

#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum MetricsErrors {
    #[error("Failed to get metrics data")]
    OneShotError(#[from] tokio::sync::oneshot::error::RecvError),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum MetricEvent {
    // GetMetricsRegistryAsString(tokio::sync::oneshot::Sender<String>),
    IngestedEvent {
        topic: String,
        timestamp: DateTime<Utc>,
        count: u64,
        bytes: u64,
        latency: Duration,
        route: String,
        method: String,
    },
    ConsumedEvent {
        timestamp: DateTime<Utc>,
        count: u64,
        latency: Duration,
        bytes: u64,
        route: String,
        method: String,
    },
    StreamingFunctionEvent {
        timestamp: DateTime<Utc>,
        count_in: u64,
        count_out: u64,
        bytes: u64,
        function_name: String,
    },
    TopicToOLAPEvent {
        timestamp: DateTime<Utc>,
        count: u64,
        bytes: u64,
        consumer_group: String,
        topic_name: String,
    },
}

#[derive(Clone)]
pub struct TelemetryMetadata {
    pub machine_id: String,
    pub is_moose_developer: bool,
    pub metric_labels: Option<String>,
    pub metric_endpoints: Option<String>,
    pub is_production: bool,
    pub project_name: String,
    pub export_metrics: bool,
}

#[derive(Clone)]
pub struct Metrics {
    pub tx_events: tokio::sync::mpsc::Sender<MetricEvent>,
    telemetry_metadata: TelemetryMetadata,
    metrics_inserter: MetricsInserter,
    registry: Arc<Mutex<Registry>>,
}

#[derive(Clone, Debug)]
pub struct Statistics {
    pub http_latency_histogram_aggregate: Histogram,
    pub http_latency_histogram: Family<HTTPLabel, Histogram>,
    pub http_ingested_latency_sum_ms: Counter,
    pub http_ingested_request_count: Counter,
    pub http_ingested_total_bytes: Counter,
    pub http_ingested_bytes: Family<HTTPLabel, Counter>,
    pub http_consumed_request_count: Counter,
    pub http_consumed_latency_sum_ms: Counter,
    pub http_consumed_bytes: Family<HTTPLabel, Counter>,
    pub http_to_topic_event_count: Family<MessagesInCounterLabels, Counter>,
    pub blocks_count: Gauge,
    pub topic_to_olap_event_count: Family<MessagesOutCounterLabels, Counter>,
    pub topic_to_olap_event_total_count: Counter,
    pub topic_to_olap_bytes_count: Family<MessagesOutCounterLabels, Counter>,
    pub topic_to_olap_bytes_total_count: Counter,
    pub streaming_functions_in_event_count: Family<StreamingFunctionMessagesCounterLabels, Counter>,
    pub streaming_functions_out_event_count:
        Family<StreamingFunctionMessagesCounterLabels, Counter>,
    pub streaming_functions_processed_bytes_count:
        Family<StreamingFunctionMessagesCounterLabels, Counter>,
    pub streaming_functions_in_event_total_count: Counter,
    pub streaming_functions_out_event_total_count: Counter,
    pub streaming_functions_processed_bytes_total_count: Counter,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct HTTPLabel {
    method: String,
    path: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct StreamingFunctionMessagesCounterLabels {
    function_name: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct MessagesInCounterLabels {
    path: String,
    method: String,
    topic_name: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct MessagesOutCounterLabels {
    consumer_group: String,
    topic_name: String,
}

impl Metrics {
    pub fn new(
        telemetry_metadata: TelemetryMetadata,
        redis_client: Option<Arc<RedisClient>>,
    ) -> (Metrics, tokio::sync::mpsc::Receiver<MetricEvent>) {
        let (tx_events, rx_events) = tokio::sync::mpsc::channel(32);
        let metric_labels = match telemetry_metadata
            .metric_labels
            .as_deref()
            .map(decode_object::decode_base64_to_json)
        {
            Some(Ok(Value::Object(map))) => Some(map),
            _ => None,
        };
        let metric_endpoints = match telemetry_metadata
            .metric_endpoints
            .as_deref()
            .map(decode_object::decode_base64_to_json)
        {
            Some(Ok(Value::Object(map))) => Some(map),
            _ => None,
        };
        let metrics = Metrics {
            tx_events,
            telemetry_metadata: telemetry_metadata.clone(),
            metrics_inserter: MetricsInserter::new(metric_labels, metric_endpoints, redis_client),
            registry: Arc::new(Mutex::new(Registry::default())),
        };
        (metrics, rx_events)
    }

    pub async fn send_metric_event(&self, data: MetricEvent) {
        let _ = self.tx_events.send(data).await;
    }

    pub async fn get_metrics_registry_as_string(&self) -> String {
        let registry = self.registry.lock().await;
        formatted_registry(&registry)
    }

    pub async fn start_listening_to_metrics(
        &self,
        mut rx_events: tokio::sync::mpsc::Receiver<MetricEvent>,
    ) {
        let data = Arc::new(Statistics {
            http_ingested_request_count: Counter::default(),
            http_ingested_total_bytes: Counter::default(),
            http_ingested_latency_sum_ms: Counter::default(),
            http_consumed_latency_sum_ms: Counter::default(),
            http_consumed_request_count: Counter::default(),
            streaming_functions_in_event_total_count: Counter::default(),
            streaming_functions_out_event_total_count: Counter::default(),
            streaming_functions_processed_bytes_total_count: Counter::default(),
            topic_to_olap_event_total_count: Counter::default(),
            blocks_count: Gauge::default(),
            topic_to_olap_bytes_total_count: Counter::default(),
            http_latency_histogram_aggregate: Histogram::new(
                [
                    0.001, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1.0, 5.0, 10.0, 30.0, 60.0, 120.0,
                    240.0,
                ]
                .into_iter(),
            ),
            http_latency_histogram: Family::<HTTPLabel, Histogram>::new_with_constructor(|| {
                Histogram::new(
                    [
                        0.001, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1.0, 5.0, 10.0, 30.0, 60.0, 120.0,
                        240.0,
                    ]
                    .into_iter(),
                )
            }),
            http_ingested_bytes: Family::<HTTPLabel, Counter>::new_with_constructor(|| {
                Counter::default()
            }),
            http_consumed_bytes: Family::<HTTPLabel, Counter>::new_with_constructor(|| {
                Counter::default()
            }),
            http_to_topic_event_count:
                Family::<MessagesInCounterLabels, Counter>::new_with_constructor(Counter::default),
            topic_to_olap_event_count:
                Family::<MessagesOutCounterLabels, Counter>::new_with_constructor(Counter::default),
            topic_to_olap_bytes_count:
                Family::<MessagesOutCounterLabels, Counter>::new_with_constructor(Counter::default),
            streaming_functions_in_event_count: Family::<
                StreamingFunctionMessagesCounterLabels,
                Counter,
            >::new_with_constructor(
                Counter::default
            ),
            streaming_functions_out_event_count: Family::<
                StreamingFunctionMessagesCounterLabels,
                Counter,
            >::new_with_constructor(
                Counter::default
            ),
            streaming_functions_processed_bytes_count: Family::<
                StreamingFunctionMessagesCounterLabels,
                Counter,
            >::new_with_constructor(
                Counter::default
            ),
        });

        let mut registry = self.registry.lock().await;

        registry.register(
            TOTAL_LATENCY,
            "Total latency of HTTP requests",
            // Those clones are ok because this is cloning an Arc reference behind the scenes
            data.http_latency_histogram_aggregate.clone(),
        );
        registry.register(
            LATENCY,
            "Latency of HTTP requests",
            data.http_latency_histogram.clone(),
        );
        registry.register(
            INGESTED_BYTES,
            "Bytes received through ingest endpoints",
            data.http_ingested_bytes.clone(),
        );
        registry.register(
            CONSUMED_BYTES,
            "Bytes sent out through analytics endpoints",
            data.http_consumed_bytes.clone(),
        );
        registry.register(
            HTTP_TO_TOPIC_EVENT_COUNT,
            "Messages sent to kafka stream",
            data.http_to_topic_event_count.clone(),
        );
        registry.register(
            TOPIC_TO_OLAP_EVENT_COUNT,
            "Messages received from kafka stream",
            data.topic_to_olap_event_count.clone(),
        );

        registry.register(
            STREAMING_FUNCTION_EVENT_INPUT_COUNT,
            "Messages sent from one data model to another using kafka stream",
            data.streaming_functions_in_event_count.clone(),
        );
        registry.register(
            STREAMING_FUNCTION_EVENT_OUPUT_COUNT,
            "Messages received from one data model to another using kafka stream",
            data.streaming_functions_out_event_count.clone(),
        );

        registry.register(
            TOPIC_TO_OLAP_BYTE_COUNT,
            "Bytes sent to clickhouse",
            data.topic_to_olap_bytes_count.clone(),
        );
        registry.register(
            STREAMING_FUNCTION_PROCESSED_BYTE_COUNT,
            "Bytes sent from one data model to another using kafka stream",
            data.streaming_functions_processed_bytes_count.clone(),
        );

        let metrics_inserter = self.metrics_inserter.clone();
        let export_metrics = self.telemetry_metadata.export_metrics;

        tokio::spawn(async move {
            while let Some(message) = rx_events.recv().await {
                if export_metrics {
                    let _ = metrics_inserter.insert(message.clone()).await;
                }

                trace!("Received Metrics Event: {:?}", message);

                match message {
                    MetricEvent::IngestedEvent {
                        timestamp: _,
                        count,
                        bytes,
                        latency,
                        route,
                        method,
                        topic,
                    } => {
                        data.http_ingested_bytes
                            .get_or_create(&HTTPLabel {
                                method: method.clone(),
                                path: route.clone(),
                            })
                            .inc_by(bytes);

                        data.http_ingested_request_count.inc();
                        data.http_ingested_total_bytes.inc_by(bytes);

                        data.http_latency_histogram
                            .get_or_create(&HTTPLabel {
                                method: method.clone(),
                                path: route.clone(),
                            })
                            .observe(latency.as_secs_f64());

                        data.http_latency_histogram_aggregate
                            .observe(latency.as_secs_f64());

                        data.http_ingested_latency_sum_ms
                            .inc_by(latency.as_millis() as u64);

                        data.http_to_topic_event_count
                            .get_or_create(&MessagesInCounterLabels {
                                path: route.clone(),
                                topic_name: topic.clone(),
                                method: method.clone(),
                            })
                            .inc_by(count);
                    }
                    MetricEvent::ConsumedEvent {
                        timestamp: _,
                        count: _,
                        latency,
                        bytes,
                        route,
                        method,
                    } => {
                        data.http_latency_histogram
                            .get_or_create(&HTTPLabel {
                                method: method.clone(),
                                path: route.clone(),
                            })
                            .observe(latency.as_secs_f64());

                        data.http_latency_histogram_aggregate
                            .observe(latency.as_secs_f64());

                        data.http_consumed_latency_sum_ms
                            .inc_by(latency.as_millis() as u64);

                        data.http_consumed_bytes
                            .get_or_create(&HTTPLabel {
                                method: method.clone(),
                                path: route.clone(),
                            })
                            .inc_by(bytes);
                    }
                    MetricEvent::TopicToOLAPEvent {
                        timestamp: _,
                        count,
                        bytes,
                        consumer_group,
                        topic_name,
                    } => {
                        data.topic_to_olap_event_count
                            .get_or_create(&MessagesOutCounterLabels {
                                consumer_group: consumer_group.clone(),
                                topic_name: topic_name.clone(),
                            })
                            .inc_by(count);
                        data.topic_to_olap_event_total_count.inc_by(count);

                        data.topic_to_olap_bytes_count
                            .get_or_create(&MessagesOutCounterLabels {
                                consumer_group: consumer_group.clone(),
                                topic_name: topic_name.clone(),
                            })
                            .inc_by(bytes);
                        data.topic_to_olap_bytes_total_count.inc_by(bytes);
                    }
                    MetricEvent::StreamingFunctionEvent {
                        timestamp: _,
                        count_in,
                        count_out,
                        bytes,
                        function_name,
                    } => {
                        data.streaming_functions_in_event_count
                            .get_or_create(&StreamingFunctionMessagesCounterLabels {
                                function_name: function_name.clone(),
                            })
                            .inc_by(count_in);
                        data.streaming_functions_in_event_total_count
                            .inc_by(count_in);

                        data.streaming_functions_out_event_count
                            .get_or_create(&StreamingFunctionMessagesCounterLabels {
                                function_name: function_name.clone(),
                            })
                            .inc_by(count_out);
                        data.streaming_functions_out_event_total_count
                            .inc_by(count_out);

                        data.streaming_functions_processed_bytes_count
                            .get_or_create(&StreamingFunctionMessagesCounterLabels {
                                function_name: function_name.clone(),
                            })
                            .inc_by(bytes);
                        data.streaming_functions_processed_bytes_total_count
                            .inc_by(bytes);
                    }
                };

                trace!("Updated metrics: {:?}", data);
            }
        });

        // Anonymous telemetry to moosefood.514.dev has been disabled.
        // CI/CD environment info is now sent via PostHog in capture.rs.
    }
}

fn formatted_registry(data: &Registry) -> String {
    let mut buffer = String::new();
    let _ = encode(&mut buffer, data);
    buffer
}
