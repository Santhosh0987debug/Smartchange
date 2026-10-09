"""phase6 documents management + FTS index

Revision ID: c41d7e2a90b1
Revises: 0cf9a1b51ed5
"""
from alembic import op
import sqlalchemy as sa

revision = "c41d7e2a90b1"
down_revision = "0cf9a1b51ed5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("description", sa.String(), nullable=True))
    op.add_column("documents", sa.Column("category", sa.String(), nullable=True))
    op.add_column("documents", sa.Column("filename", sa.String(), nullable=True))
    op.add_column("documents", sa.Column("mime_type", sa.String(), nullable=True))
    op.add_column("documents", sa.Column("size_bytes", sa.Integer(), nullable=True))
    op.add_column("documents", sa.Column("processing_status", sa.String(), nullable=True))
    op.add_column("documents", sa.Column("chunks_json", sa.Text(), nullable=True))
    op.add_column("documents", sa.Column("uploaded_at", sa.DateTime(), nullable=True))
    op.execute("CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(doc_id, title, content)")
    op.execute("DELETE FROM documents_fts")
    op.execute("INSERT INTO documents_fts (doc_id, title, content) "
               "SELECT id, title, content FROM documents")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS documents_fts")
    for col in ("uploaded_at", "chunks_json", "processing_status", "size_bytes",
                "mime_type", "filename", "category", "description"):
        op.drop_column("documents", col)
