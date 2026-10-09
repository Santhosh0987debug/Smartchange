"""phase7 analytics indexes

Revision ID: d92e4b11c7aa
Revises: c41d7e2a90b1
"""
from alembic import op

revision = "d92e4b11c7aa"
down_revision = "c41d7e2a90b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_changeovers_status_machine_started", "changeovers",
                    ["status", "machine_id", "started_at"])
    op.create_index("ix_verification_changeover_run", "verification_results",
                    ["changeover_id", "run_number"])
    op.create_index("ix_issues_changeover_status", "issues",
                    ["changeover_id", "resolution_status"])
    op.create_index("ix_tasks_changeover", "changeover_tasks", ["changeover_id"])
    op.create_index("ix_states_machine_status", "machine_states",
                    ["machine_id", "verification_status"])


def downgrade() -> None:
    op.drop_index("ix_states_machine_status", table_name="machine_states")
    op.drop_index("ix_tasks_changeover", table_name="changeover_tasks")
    op.drop_index("ix_issues_changeover_status", table_name="issues")
    op.drop_index("ix_verification_changeover_run", table_name="verification_results")
    op.drop_index("ix_changeovers_status_machine_started", table_name="changeovers")
