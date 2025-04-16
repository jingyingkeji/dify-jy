"""
SQLAlchemy implementation of the WorkflowNodeExecutionRepository.
"""

from collections.abc import Sequence
from typing import Optional

from sqlalchemy import UnaryExpression, asc, desc, select
from sqlalchemy.orm import Session

from core.repository.workflow_node_execution_repository import OrderConfig
from models.workflow import WorkflowNodeExecution, WorkflowNodeExecutionStatus, WorkflowNodeExecutionTriggeredFrom


class SQLAlchemyWorkflowNodeExecutionRepository:
    """
    SQLAlchemy implementation of the WorkflowNodeExecutionRepository interface.

    This implementation supports multi-tenancy by filtering operations based on tenant_id.
    Each method that modifies data (save, update, delete) flushes changes to the database,
    but does not commit the transaction. Callers are responsible for committing
    or rolling back the transaction as needed.
    """

    def __init__(self, session: Session, tenant_id: str, app_id: Optional[str] = None):
        """
        Initialize the repository with a SQLAlchemy session and tenant context.

        Args:
            session: SQLAlchemy session
            tenant_id: Tenant ID for multi-tenancy
            app_id: Optional app ID for filtering by application
        """
        self.session = session
        self.tenant_id = tenant_id
        self.app_id = app_id

    def save(self, execution: WorkflowNodeExecution) -> None:
        """
        Save a WorkflowNodeExecution instance and flush changes to the database.
        The caller is responsible for committing the transaction.

        Args:
            execution: The WorkflowNodeExecution instance to save
        """
        # Ensure tenant_id is set
        if not execution.tenant_id:
            execution.tenant_id = self.tenant_id

        # Set app_id if provided and not already set
        if self.app_id and not execution.app_id:
            execution.app_id = self.app_id

        self.session.add(execution)
        self.session.flush()

    def get_by_node_execution_id(self, node_execution_id: str) -> Optional[WorkflowNodeExecution]:
        """
        Retrieve a WorkflowNodeExecution by its node_execution_id.

        Args:
            node_execution_id: The node execution ID

        Returns:
            The WorkflowNodeExecution instance if found, None otherwise
        """
        stmt = select(WorkflowNodeExecution).where(
            WorkflowNodeExecution.node_execution_id == node_execution_id,
            WorkflowNodeExecution.tenant_id == self.tenant_id,
        )

        if self.app_id:
            stmt = stmt.where(WorkflowNodeExecution.app_id == self.app_id)

        return self.session.scalar(stmt)

    def get_by_workflow_run(
        self,
        workflow_run_id: str,
        order_config: Optional[OrderConfig] = None,
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all WorkflowNodeExecution instances for a specific workflow run.

        Args:
            workflow_run_id: The workflow run ID
            order_config: Optional configuration for ordering results
                order_config.order_by: List of fields to order by (e.g., ["index", "created_at"])
                order_config.order_direction: Direction to order ("asc" or "desc")

        Returns:
            A list of WorkflowNodeExecution instances
        """
        stmt = select(WorkflowNodeExecution).where(
            WorkflowNodeExecution.workflow_run_id == workflow_run_id,
            WorkflowNodeExecution.tenant_id == self.tenant_id,
            WorkflowNodeExecution.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
        )

        if self.app_id:
            stmt = stmt.where(WorkflowNodeExecution.app_id == self.app_id)

        # Apply ordering if provided
        if order_config and order_config.order_by:
            order_columns: list[UnaryExpression] = []
            for field in order_config.order_by:
                column = getattr(WorkflowNodeExecution, field, None)
                if column:
                    if order_config.order_direction == "desc":
                        order_columns.append(desc(column))
                    else:
                        order_columns.append(asc(column))

            if order_columns:
                stmt = stmt.order_by(*order_columns)

        return self.session.scalars(stmt).all()

    def get_running_executions(self, workflow_run_id: str) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all running WorkflowNodeExecution instances for a specific workflow run.

        Args:
            workflow_run_id: The workflow run ID

        Returns:
            A list of running WorkflowNodeExecution instances
        """
        stmt = select(WorkflowNodeExecution).where(
            WorkflowNodeExecution.workflow_run_id == workflow_run_id,
            WorkflowNodeExecution.tenant_id == self.tenant_id,
            WorkflowNodeExecution.status == WorkflowNodeExecutionStatus.RUNNING.value,
            WorkflowNodeExecution.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
        )

        if self.app_id:
            stmt = stmt.where(WorkflowNodeExecution.app_id == self.app_id)

        return self.session.scalars(stmt).all()

    def update(self, execution: WorkflowNodeExecution) -> None:
        """
        Update an existing WorkflowNodeExecution instance and flush changes to the database.
        The caller is responsible for committing the transaction.

        Args:
            execution: The WorkflowNodeExecution instance to update
        """
        # Ensure tenant_id is set
        if not execution.tenant_id:
            execution.tenant_id = self.tenant_id

        # Set app_id if provided and not already set
        if self.app_id and not execution.app_id:
            execution.app_id = self.app_id

        self.session.merge(execution)
        self.session.flush()

    def delete(self, execution_id: str) -> None:
        """
        Delete a WorkflowNodeExecution by its ID and flush changes to the database.
        The caller is responsible for committing the transaction.

        Args:
            execution_id: The execution ID
        """
        stmt = select(WorkflowNodeExecution).where(
            WorkflowNodeExecution.id == execution_id, WorkflowNodeExecution.tenant_id == self.tenant_id
        )

        if self.app_id:
            stmt = stmt.where(WorkflowNodeExecution.app_id == self.app_id)

        execution = self.session.scalar(stmt)
        if execution:
            self.session.delete(execution)
            self.session.flush()
