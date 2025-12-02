/// This module is going to be the command center of moose.
/// it will be responsible for taking a program definition that will be exported by
/// the language speicifc modules and build the representation of what the state of the infrastructure should be.
/// It will then build a representation of the current state of the infrastructure and compare the two to
/// determine what needs to be done.
/// It will finally build a plan of what needs to be done and delegate execution
/// to modules specific to the infrastructure provider.
///
///
/// ┌──────────────┐                     ┌──────────────┐
/// │              │                     │              │
/// │  Python      ├──┐                ┌─►  ClickHouse  │
/// │              │  │  ┌──────────┐  │ │              │
/// └──────────────┘  │  │          │  │ └──────────────┘
///                   │  │          │  │
///                   ├──►   Core   ├──┤
/// ┌──────────────┐  │  │          │  │ ┌──────────────┐
/// │              │  │  │          │  │ │              │
/// │  Typescript  ├──┘  └──────────┘  └►│   Kafka      │
/// │              │                     │              │
/// └──────────────┘                     └──────────────┘
///
pub mod check;
pub mod execute;
pub mod infra_reality_checker;
pub mod infrastructure;
pub mod infrastructure_map;
pub mod migration_plan;
pub mod partial_infrastructure_map;
pub mod plan;
pub mod plan_validator;
pub mod primitive_map;
pub mod state_storage;
pub mod validation;
