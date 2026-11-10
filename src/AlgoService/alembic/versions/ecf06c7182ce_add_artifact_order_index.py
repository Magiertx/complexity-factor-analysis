"""add artifact order index

Revision ID: ecf06c7182ce
Revises: 391965a3c672
Create Date: 2026-06-04 20:27:51.933390

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ecf06c7182ce'
down_revision: Union[str, Sequence[str], None] = '391965a3c672'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('artifacts', sa.Column('order_index', sa.Integer(), nullable=True))
    op.execute("UPDATE artifacts SET order_index = 0")
    # Batch mode: SQLite cannot alter a column in place, so it rebuilds the table. On Postgres
    # this is the same plain ALTER COLUMN as before.
    with op.batch_alter_table('artifacts') as batch_op:
        batch_op.alter_column('order_index', existing_type=sa.Integer(), nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('artifacts') as batch_op:
        batch_op.drop_column('order_index')
