"""add feedback

Revision ID: c4d2a9e7f1b3
Revises: b1c8f4e2a3d9
Create Date: 2026-10-31 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4d2a9e7f1b3'
down_revision: Union[str, Sequence[str], None] = 'b1c8f4e2a3d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add the table of the feedback form."""
    op.create_table('feedback',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('message', sa.String(length=4000), nullable=False),
    sa.Column('contact', sa.String(length=200), nullable=True),
    sa.Column('context', sa.JSON(), nullable=True),
    sa.Column('delivered', sa.Boolean(), server_default=sa.false(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('feedback')
