use std::collections::HashMap;
use std::time::Instant;

use bytes::Bytes;
use kafka_protocol::messages::{GroupId, TopicName};
use kafka_protocol::protocol::StrBytes;
use tokio::sync::watch;

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
    pub rebalance_started_at: Option<Instant>,
    pub last_join_at: Option<Instant>,
    pub rebalance_timeout_ms: i32,
    state_epoch: u64,
    pub state_updates: watch::Sender<u64>,
}

impl ConsumerGroup {
    /// Create an empty consumer group with the given ID.
    pub fn new(group_id: GroupId) -> Self {
        let (state_updates, _) = watch::channel(0);
        Self {
            group_id,
            state: GroupState::Empty,
            generation_id: 0,
            protocol_type: None,
            protocol_name: None,
            leader_id: None,
            members: HashMap::new(),
            rebalance_started_at: None,
            last_join_at: None,
            rebalance_timeout_ms: 0,
            state_epoch: 0,
            state_updates,
        }
    }

    fn notify_state_change(&mut self) {
        self.state_epoch += 1;
        let _ = self.state_updates.send_replace(self.state_epoch);
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
    pub fn remove_member(&mut self, member_id: &StrBytes, now: Instant) {
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
            self.rebalance_started_at = None;
            self.last_join_at = None;
            self.rebalance_timeout_ms = 0;
        } else {
            self.state = GroupState::PreparingRebalance;
            self.rebalance_started_at = Some(now);
            self.last_join_at = Some(now);
            self.rebalance_timeout_ms = self
                .members
                .values()
                .map(|member| member.rebalance_timeout_ms.max(1000))
                .max()
                .unwrap_or(1000);
        }
        self.notify_state_change();
    }

    pub fn prepare_rebalance(&mut self, now: Instant, rebalance_timeout_ms: i32) {
        let rebalance_timeout_ms = rebalance_timeout_ms.max(1000);
        if self.state != GroupState::PreparingRebalance {
            self.rebalance_started_at = Some(now);
            self.rebalance_timeout_ms = rebalance_timeout_ms;
        } else {
            self.rebalance_timeout_ms = self.rebalance_timeout_ms.max(rebalance_timeout_ms);
        }

        self.state = GroupState::PreparingRebalance;
        self.last_join_at = Some(now);
        self.notify_state_change();
    }

    pub fn should_finalize_rebalance(
        &self,
        now: Instant,
        quiet_period: std::time::Duration,
    ) -> bool {
        if self.state != GroupState::PreparingRebalance {
            return false;
        }

        let quiet_elapsed = self
            .last_join_at
            .map(|last_join_at| now.duration_since(last_join_at) >= quiet_period)
            .unwrap_or(false);

        let timed_out = self
            .rebalance_started_at
            .map(|rebalance_started_at| {
                now.duration_since(rebalance_started_at).as_millis()
                    >= self.rebalance_timeout_ms.max(0) as u128
            })
            .unwrap_or(false);

        quiet_elapsed || timed_out
    }

    pub fn rebalance_wait_duration(
        &self,
        now: Instant,
        quiet_period: std::time::Duration,
    ) -> std::time::Duration {
        let until_quiet = self
            .last_join_at
            .map(|last_join_at| {
                quiet_period.saturating_sub(now.saturating_duration_since(last_join_at))
            })
            .unwrap_or_default();

        let until_timeout = self
            .rebalance_started_at
            .map(|rebalance_started_at| {
                std::time::Duration::from_millis(self.rebalance_timeout_ms.max(0) as u64)
                    .saturating_sub(now.saturating_duration_since(rebalance_started_at))
            })
            .unwrap_or_default();

        match (until_quiet.is_zero(), until_timeout.is_zero()) {
            (true, true) => std::time::Duration::from_millis(0),
            (true, false) => until_timeout,
            (false, true) => until_quiet,
            (false, false) => until_quiet.min(until_timeout),
        }
    }

    pub fn finalize_rebalance(&mut self) {
        if self.leader_id.is_none()
            || !self
                .members
                .contains_key(self.leader_id.as_ref().expect("leader_id checked above"))
        {
            self.leader_id = self.members.keys().next().cloned();
        }

        self.protocol_name = self.choose_protocol();
        self.generation_id += 1;
        self.state = GroupState::CompletingRebalance;
        self.rebalance_started_at = None;
        self.last_join_at = None;
        self.notify_state_change();
    }

    pub fn mark_stable(&mut self) {
        self.state = GroupState::Stable;
        self.notify_state_change();
    }

    /// Remove members whose last heartbeat exceeds their session timeout.
    pub fn reap_expired_members(&mut self, now: Instant, reason: &str) {
        let expired: Vec<StrBytes> = self
            .members
            .iter()
            .filter(|(_, member)| {
                let timeout_ms = member.session_timeout_ms.max(0) as u128;
                now.duration_since(member.last_heartbeat).as_millis() > timeout_ms
            })
            .map(|(member_id, _)| member_id.clone())
            .collect();

        for member_id in expired {
            tracing::info!(
                group = %self.group_id.0,
                member = %member_id,
                reason,
                "Reaping expired member"
            );
            self.remove_member(&member_id, now);
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
            group.reap_expired_members(now, "background_reaper");
            if group.members.is_empty() && group.state == GroupState::Empty {
                self.groups.remove(&group_id);
            }
        }
    }
}
