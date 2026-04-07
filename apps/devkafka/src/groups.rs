use std::collections::HashMap;
use std::time::Instant;

use bytes::Bytes;
use kafka_protocol::messages::{GroupId, TopicName};
use kafka_protocol::protocol::StrBytes;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GroupState {
    Empty,
    PreparingRebalance,
    CompletingRebalance,
    Stable,
}

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

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct OffsetKey {
    pub group_id: GroupId,
    pub topic: TopicName,
    pub partition: i32,
}

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
    pub fn new() -> Self {
        Self {
            groups: HashMap::new(),
            committed_offsets: HashMap::new(),
        }
    }

    pub fn get_or_create_group(&mut self, group_id: GroupId) -> &mut ConsumerGroup {
        self.groups
            .entry(group_id.clone())
            .or_insert_with(|| ConsumerGroup::new(group_id))
    }

    pub fn reap_expired_members(&mut self) {
        let now = Instant::now();
        let group_ids: Vec<GroupId> = self.groups.keys().cloned().collect();
        for group_id in group_ids {
            let group = self.groups.get_mut(&group_id).unwrap();
            let expired: Vec<StrBytes> = group
                .members
                .iter()
                .filter(|(_, m)| {
                    now.duration_since(m.last_heartbeat).as_millis() > m.session_timeout_ms as u128
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
