"""Tests for OlapTable constraints."""

import pytest
from moose_lib.dmv2 import OlapTable, OlapConfig, MooseModel
from moose_lib.blocks import MergeTreeEngine
from moose_lib.internal import to_infra_map


def test_olaptable_constraints_serialization():
    """OlapTable should properly serialize constraints."""

    class User(MooseModel):
        user_id: int
        email: str

    table = OlapTable[User](
        "users_with_constraints",
        OlapConfig(
            engine=MergeTreeEngine(),
            constraints=[
                OlapConfig.TableConstraint(
                    name="email_length",
                    expression="length(email) > 0",
                    type="CHECK",
                ),
                OlapConfig.TableConstraint(
                    name="assume_user_id_positive",
                    expression="user_id > 0",
                    type="ASSUME",
                ),
            ],
        ),
    )

    infra_map = to_infra_map()
    assert "users_with_constraints" in infra_map["tables"]
    table_config = infra_map["tables"]["users_with_constraints"]

    assert "constraints" in table_config
    assert len(table_config["constraints"]) == 2

    assert table_config["constraints"][0]["name"] == "email_length"
    assert table_config["constraints"][0]["expression"] == "length(email) > 0"
    assert table_config["constraints"][0]["type"] == "CHECK"

    assert table_config["constraints"][1]["name"] == "assume_user_id_positive"
    assert table_config["constraints"][1]["expression"] == "user_id > 0"
    assert table_config["constraints"][1]["type"] == "ASSUME"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
