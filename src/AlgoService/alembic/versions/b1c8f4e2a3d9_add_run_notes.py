"""add run notes

Revision ID: b1c8f4e2a3d9
Revises: ecf06c7182ce
Create Date: 2026-06-07 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c8f4e2a3d9'
down_revision: Union[str, Sequence[str], None] = 'ecf06c7182ce'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add free-text notes column to runs."""
    op.add_column('runs', sa.Column('notes', sa.String(length=2000), nullable=True))


def downgrade() -> None:
    op.drop_column('runs', 'notes')
