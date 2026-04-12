use std::collections::HashMap;
use std::time::Instant;

use bytes::Bytes;
use kafka_protocol::messages::{GroupId, TopicName};
use kafka_protocol::protocol::StrBytes;

/// Consumer group lifecycle state, following the Kafka protocol state machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GroupState {
    /// No members have joined.
    Empty,
    /// A rebalance has been triggered; waiting for members to join.
    PreparingRebalance,
    /// All members have joined; waiting for the leader to sync assignments.
    CompletingRebalance,
    /// Assignments distributed; group is actively consuming.
    Stable,
}

impl GroupState {
    /// Return the Kafka protocol string representation of this state.
    pub fn as_str(&self) -> &'static str {
        match self {
            GroupState::Empty => "Empty",
            GroupState::PreparingRebalance => "PreparingRebalance",
            GroupState::CompletingRebalance => "CompletingRebalance",
            GroupState::Stable => "Stable",
        }
    }
}

/// A single member of a consumer group.
#[allow(dead_code)]
pub struct GroupMember {
    pub member_id: StrBytes,
    pub client_id: StrBytes,
    pub client_host: StrBytes,
    pub protocol_type: StrBytes,
    pub protocols: Vec<(StrBytes, Bytes)>,
    pub assignment: Bytes,
    pub session_timeout_ms: i32,
    pub rebalance_timeout_ms: i32,
    pub last_heartbeat: Instant,
}

/// State for a single consumer group, including members and protocol negotiation.
#[allow(dead_code)]
pub struct ConsumerGroup {
    pub group_id: GroupId,
    pub state: GroupState,
    pub generation_id: i32,
    pub protocol_type: Option<StrBytes>,
    pub protocol_name: Option<StrBytes>,
    pub leader_id: Option<StrBytes>,
    pub members: HashMap<StrBytes, GroupMember>,
}

impl ConsumerGroup {
    /// Create an empty consumer group with the given ID.
    pub fn new(group_id: GroupId) -> Self {
        Self {
            group_id,
            state: GroupState::Empty,
            generation_id: 0,
            protocol_type: None,
            protocol_name: None,
            leader_id: None,
            members: HashMap::new(),
        }
    }

    /// Select a partition assignment protocol supported by all members.
    ///
    /// Uses the first member's protocol list as the preference order, matching
    /// standard Kafka behavior where the group leader's preference wins.
    pub fn choose_protocol(&self) -> Option<StrBytes> {
        if self.members.is_empty() {
            return None;
        }
        let first_member = self.members.values().next()?;
        for (proto_name, _) in &first_member.protocols {
            let all_support = self
                .members
                .values()
                .all(|m| m.protocols.iter().any(|(p, _)| p == proto_name));
            if all_support {
                return Some(proto_name.clone());
            }
        }
        None
    }

    /// Remove a member from the group, re-electing the leader if necessary.
    pub fn remove_member(&mut self, member_id: &StrBytes) {
        self.members.remove(member_id);
        if self.leader_id.as_ref() == Some(member_id) {
            self.leader_id = self.members.keys().next().cloned();
        }
        if self.members.is_empty() {
            self.state = GroupState::Empty;
            self.generation_id = 0;
            self.leader_id = None;
            self.protocol_type = None;
            self.protocol_name = None;
        } else {
            self.state = GroupState::PreparingRebalance;
        }
    }
}

/// Key for committed offset storage: (group, topic, partition).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct OffsetKey {
    pub group_id: GroupId,
    pub topic: TopicName,
    pub partition: i32,
}

/// Top-level coordinator managing all consumer groups and committed offsets.
pub struct GroupCoordinator {
    pub groups: HashMap<GroupId, ConsumerGroup>,
    pub committed_offsets: HashMap<OffsetKey, i64>,
}

impl Default for GroupCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl GroupCoordinator {
    /// Create an empty group coordinator.
    pub fn new() -> Self {
        Self {
            groups: HashMap::new(),
            committed_offsets: HashMap::new(),
        }
    }

    /// Return the group for `group_id`, creating an empty one if it doesn't exist.
    pub fn get_or_create_group(&mut self, group_id: GroupId) -> &mut ConsumerGroup {
        self.groups
            .entry(group_id.clone())
            .or_insert_with(|| ConsumerGroup::new(group_id))
    }

    /// Remove members whose last heartbeat exceeds their session timeout,
    /// and clean up empty groups.
    pub fn reap_expired_members(&mut self) {
        let now = Instant::now();
        let group_ids: Vec<GroupId> = self.groups.keys().cloned().collect();
        for group_id in group_ids {
            let group = self.groups.get_mut(&group_id).unwrap();
            let expired: Vec<StrBytes> = group
                .members
                .iter()
                .filter(|(_, m)| {
                    let timeout_ms = m.session_timeout_ms.max(0) as u128;
                    now.duration_since(m.last_heartbeat).as_millis() > timeout_ms
                })
                .map(|(id, _)| id.clone())
                .collect();
            for member_id in expired {
                tracing::info!(
                    group = %group_id.0,
                    member = %member_id,
                    "Reaping expired member"
                );
                group.remove_member(&member_id);
            }
            if group.members.is_empty() && group.state == GroupState::Empty {
                self.groups.remove(&group_id);
            }
        }
    }
}
