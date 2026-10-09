"""Relational models per implementation plan section 10."""
from sqlalchemy import Column, Integer, String, Float, DateTime, Text, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base


class User(Base):
    """Demo users for the prototype. No real authentication — the UI selects a
    demo identity and every write is attributed via audit_events.actor_id."""
    __tablename__ = "users"
    id = Column(String, primary_key=True)  # e.g. demo-operator
    name = Column(String, nullable=False)
    role = Column(String, nullable=False)  # operator | supervisor | engineer
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Machine(Base):
    __tablename__ = "machines"
    id = Column(String, primary_key=True)  # e.g. FILL-01
    name = Column(String, nullable=False)
    machine_type = Column(String, nullable=True)  # e.g. Filling, Packaging
    line = Column(String, nullable=True)  # e.g. Line A
    location = Column(String, nullable=True)  # e.g. Hall 1
    status = Column(String, default="Operational")
    # Managed values: Operational | Maintenance | Offline.
    # Workflow-transient values set by the changeover engine: Idle | Ready | Changeover | Fault.
    current_product_id = Column(String, ForeignKey("products.id"), nullable=True)
    configuration_version = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Product(Base):
    __tablename__ = "products"
    id = Column(String, primary_key=True)  # A, B, C
    product_code = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    configuration_json = Column(Text, nullable=False)  # canonical target config
    revision = Column(String, default="v1.0")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MachineState(Base):
    __tablename__ = "machine_states"
    id = Column(Integer, primary_key=True, autoincrement=True)
    machine_id = Column(String, ForeignKey("machines.id"), nullable=False)
    product_id = Column(String, ForeignKey("products.id"), nullable=True)
    # Owning changeover for simulated (PENDING) rows; NULL for official history.
    changeover_id = Column(Integer, nullable=True)
    component_state_json = Column(Text, nullable=False)
    parameter_state_json = Column(Text, nullable=False)
    verification_status = Column(String, default="VERIFIED")  # VERIFIED | PENDING | FAILED
    recorded_at = Column(DateTime, default=datetime.utcnow)


class Changeover(Base):
    __tablename__ = "changeovers"
    id = Column(Integer, primary_key=True, autoincrement=True)
    machine_id = Column(String, ForeignKey("machines.id"), nullable=False)
    source_product_id = Column(String, nullable=True)
    target_product_id = Column(String, nullable=False)
    status = Column(String, default="IN_PROGRESS")  # IN_PROGRESS | VERIFIED | COMPLETED | ABANDONED | FAILED
    operator_id = Column(String, default="demo-operator")
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    baseline_duration_seconds = Column(Integer, default=1080)  # 18 min manual baseline
    actual_duration_seconds = Column(Integer, nullable=True)
    source_snapshot_json = Column(Text, nullable=True)
    target_snapshot_json = Column(Text, nullable=True)
    tasks = relationship("ChangeoverTask", back_populates="changeover", cascade="all, delete-orphan")


class ChangeoverTask(Base):
    __tablename__ = "changeover_tasks"
    id = Column(Integer, primary_key=True, autoincrement=True)
    changeover_id = Column(Integer, ForeignKey("changeovers.id"), nullable=False)
    step_id = Column(String, nullable=True)  # e.g. S01, unique within a changeover
    sequence_number = Column(Integer, nullable=False)
    task_type = Column(String, nullable=False)  # physical | configuration | verification
    category = Column(String, nullable=True)  # safety | component_replacement | parameter_adjustment | verification
    description = Column(String, nullable=False)
    instructions = Column(String, nullable=True)
    component = Column(String, nullable=True)
    parameter = Column(String, nullable=True)
    current_value = Column(String, nullable=True)
    target_value = Column(String, nullable=True)
    prerequisites = Column(Text, default="[]")  # JSON list of sequence_numbers
    safety_notes = Column(String, default="")
    verification_criteria = Column(String, default="")
    requires_confirmation = Column(Boolean, default=True)
    expected_duration_seconds = Column(Integer, default=120)  # estimate, not measured data
    status = Column(String, default="PENDING")  # PENDING | IN_PROGRESS | COMPLETED | FAILED
    completed_at = Column(DateTime, nullable=True)
    changeover = relationship("Changeover", back_populates="tasks")


class VerificationResult(Base):
    __tablename__ = "verification_results"
    id = Column(Integer, primary_key=True, autoincrement=True)
    changeover_id = Column(Integer, ForeignKey("changeovers.id"), nullable=False)
    run_number = Column(Integer, default=1)  # increments per verification run; history preserved
    task_id = Column(Integer, nullable=True)
    check_name = Column(String, nullable=False)
    expected_value = Column(String, nullable=True)
    actual_value = Column(String, nullable=True)
    result = Column(String, nullable=False)  # PASS | FAIL
    reason = Column(String, nullable=True)  # failure explanation; NULL when passed
    checked_at = Column(DateTime, default=datetime.utcnow)


class Issue(Base):
    __tablename__ = "issues"
    id = Column(Integer, primary_key=True, autoincrement=True)
    changeover_id = Column(Integer, ForeignKey("changeovers.id"), nullable=False)
    task_id = Column(Integer, nullable=True)
    category = Column(String, default="general")
    severity = Column(String, default="minor")  # info | minor | major | critical
    description = Column(String, nullable=False)
    resolution_status = Column(String, default="OPEN")  # OPEN | RESOLVED
    created_at = Column(DateTime, default=datetime.utcnow)


class Document(Base):
    __tablename__ = "documents"
    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String, nullable=False)
    description = Column(String, nullable=True)
    category = Column(String, nullable=True)  # e.g. SOP, Manual, Troubleshooting
    revision = Column(String, default="v1.0")
    approval_status = Column(String, default="Draft")  # Draft | Approved | Archived
    effective_date = Column(String, default="")
    filename = Column(String, nullable=True)  # original name, informational only
    mime_type = Column(String, nullable=True)
    size_bytes = Column(Integer, nullable=True)
    processing_status = Column(String, default="READY")  # READY | FAILED
    content = Column(Text, nullable=False)  # extracted plain text (never executed)
    chunks_json = Column(Text, nullable=True)  # JSON [{section, text}] with page/section labels
    uploaded_at = Column(DateTime, default=datetime.utcnow)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id = Column(Integer, primary_key=True, autoincrement=True)
    actor_id = Column(String, default="system")
    entity_type = Column(String, nullable=False)
    entity_id = Column(String, nullable=False)
    action = Column(String, nullable=False)
    details_json = Column(Text, default="{}")
    timestamp = Column(DateTime, default=datetime.utcnow)
