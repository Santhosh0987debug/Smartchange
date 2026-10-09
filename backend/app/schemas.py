from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


MANAGED_MACHINE_STATUSES = ("Operational", "Maintenance", "Offline")
# Values the changeover engine itself assigns during a workflow run.
WORKFLOW_MACHINE_STATUSES = ("Idle", "Ready", "Changeover", "Fault")
ALLOWED_MACHINE_STATUSES = MANAGED_MACHINE_STATUSES + WORKFLOW_MACHINE_STATUSES


class MachineOut(BaseModel):
    id: str
    name: str
    machine_type: Optional[str] = None
    line: Optional[str] = None
    location: Optional[str] = None
    status: str
    current_product_id: Optional[str] = None
    configuration_version: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class MachineCreate(BaseModel):
    id: str = Field(..., min_length=1, max_length=32, examples=["FILL-02"])
    name: str = Field(..., min_length=1, max_length=120)
    machine_type: Optional[str] = Field(default=None, max_length=60)
    line: Optional[str] = Field(default=None, max_length=60)
    location: Optional[str] = Field(default=None, max_length=120)
    status: str = "Operational"
    current_product_id: Optional[str] = None


class MachineUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    machine_type: Optional[str] = Field(default=None, max_length=60)
    line: Optional[str] = Field(default=None, max_length=120)
    location: Optional[str] = Field(default=None, max_length=120)
    status: Optional[str] = None
    current_product_id: Optional[str] = None


class ProductOut(BaseModel):
    id: str
    product_code: str
    name: str
    description: Optional[str] = None
    configuration: Dict[str, Any]
    revision: str
    active: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ProductCreate(BaseModel):
    id: str = Field(..., min_length=1, max_length=32, examples=["D"])
    product_code: str = Field(..., min_length=1, max_length=32, examples=["PROD-D"])
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    configuration: Dict[str, Any]
    revision: str = "v1.0"
    active: bool = True


class ProductUpdate(BaseModel):
    product_code: Optional[str] = Field(default=None, min_length=1, max_length=32)
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    configuration: Optional[Dict[str, Any]] = None
    revision: Optional[str] = Field(default=None, max_length=32)
    active: Optional[bool] = None


class UserOut(BaseModel):
    id: str
    name: str
    role: str
    active: bool


class StateOut(BaseModel):
    machine_id: str
    product_id: Optional[str] = None
    components: Dict[str, Any]
    parameters: Dict[str, Any]
    verification_status: str
    recorded_at: Optional[str] = None


class PreviewRequest(BaseModel):
    machine_id: str = Field(..., examples=["FILL-01"])
    target_product_id: str = Field(..., examples=["B"])
    operator_id: str = "demo-operator"


class CreateChangeoverRequest(PreviewRequest):
    pass


class TaskOut(BaseModel):
    id: int
    step_id: Optional[str] = None
    sequence_number: int
    task_type: str
    category: Optional[str] = None
    description: str
    instructions: Optional[str] = None
    component: Optional[str] = None
    parameter: Optional[str] = None
    current_value: Optional[str] = None
    target_value: Optional[str] = None
    prerequisites: List[int] = []
    safety_notes: str = ""
    verification_criteria: str = ""
    requires_confirmation: bool = True
    expected_duration_seconds: int = 120
    status: str


class TaskUpdate(BaseModel):
    status: str  # IN_PROGRESS | COMPLETED | FAILED
    operator_id: str = "demo-operator"
    reason: Optional[str] = None  # required when status is FAILED


class ApplyConfigRequest(BaseModel):
    parameters: Dict[str, Any] = {}  # e.g. {"speed_rpm": 120, "pressure_bar": 3.0}
    mark_physical_complete: bool = False
    operator_id: str = "demo-operator"


ISSUE_SEVERITIES = ("info", "minor", "major", "critical")


class IssueCreate(BaseModel):
    task_id: Optional[int] = None
    category: str = "general"
    severity: str = "minor"
    description: str
    operator_id: str = "demo-operator"


class StepAction(BaseModel):
    """Body for step start/complete/fail actions. Fail requires a reason."""
    operator_id: str = "demo-operator"
    reason: Optional[str] = None
    note: Optional[str] = None


class StepNote(BaseModel):
    note: str = Field(..., min_length=1, max_length=2000)
    operator_id: str = "demo-operator"


class AssistantQuery(BaseModel):
    question: str
    top_k: int = 3


DOC_APPROVAL_STATUSES = ("Draft", "Approved", "Archived")


class DocumentOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    revision: str
    approval_status: str
    effective_date: str = ""
    filename: Optional[str] = None
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None
    processing_status: str = "READY"
    preview: str = ""
    content_length: int = 0
    uploaded_at: Optional[str] = None


class DocumentActor(BaseModel):
    operator_id: str = "demo-operator"


class AiAskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    machine_id: Optional[str] = None
    target_product_id: Optional[str] = None
    changeover_id: Optional[int] = None
    top_k: int = Field(default=3, ge=1, le=10)
