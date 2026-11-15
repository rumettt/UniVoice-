import { PoolClient } from 'pg';
import { pool } from '../config/db';

export interface RequestTransferRecord {
  id: string;
  requestId: string;
  sequenceNo: number;
  fromDepartmentId: string;
  fromDepartmentName?: string;
  fromDepartmentCode?: string;
  toDepartmentId: string;
  toDepartmentName?: string;
  toDepartmentCode?: string;
  fromCategoryId: string;
  fromCategoryName?: string;
  toCategoryId: string;
  toCategoryName?: string;
  fromAuthorityLevelId: string;
  fromAuthorityLevelName?: string;
  fromAuthorityLevelOrder?: number;
  toAuthorityLevelId: string;
  toAuthorityLevelName?: string;
  toAuthorityLevelOrder?: number;
  initiatedBy: string;
  initiatorName?: string;
  initiatedAssignmentId: string | null;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  decidedBy: string | null;
  decidedByName?: string | null;
  decidedAt: Date | null;
  rejectionReason: string | null;
  cancellationReason: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  request?: {
    id: string;
    publicRef: string;
    title: string;
    priority: string;
  };
}

export class TransferRepository {
  /**
   * Find an active pending transfer for a specific request.
   */
  async findPendingByRequestId(
    requestId: string,
    client?: PoolClient,
  ): Promise<RequestTransferRecord | null> {
    const db = client ?? pool;
    const query = `
      SELECT
        rt.id,
        rt.request_id AS "requestId",
        rt.sequence_no AS "sequenceNo",
        rt.from_department_id AS "fromDepartmentId",
        fd.name AS "fromDepartmentName",
        fd.code AS "fromDepartmentCode",
        rt.to_department_id AS "toDepartmentId",
        td.name AS "toDepartmentName",
        td.code AS "toDepartmentCode",
        rt.from_category_id AS "fromCategoryId",
        fc.name AS "fromCategoryName",
        rt.to_category_id AS "toCategoryId",
        tc.name AS "toCategoryName",
        rt.from_authority_level_id AS "fromAuthorityLevelId",
        fal.name AS "fromAuthorityLevelName",
        fal.level_order AS "fromAuthorityLevelOrder",
        rt.to_authority_level_id AS "toAuthorityLevelId",
        tal.name AS "toAuthorityLevelName",
        tal.level_order AS "toAuthorityLevelOrder",
        rt.initiated_by AS "initiatedBy",
        u.full_name AS "initiatorName",
        rt.initiated_assignment_id AS "initiatedAssignmentId",
        rt.reason,
        rt.status,
        rt.decided_by AS "decidedBy",
        rt.decided_at AS "decidedAt",
        rt.rejection_reason AS "rejectionReason",
        rt.cancellation_reason AS "cancellationReason",
        rt.cancelled_at AS "cancelledAt",
        rt.cancelled_by AS "cancelledBy",
        rt.created_at AS "createdAt",
        rt.updated_at AS "updatedAt"
      FROM request_transfers rt
      JOIN departments fd ON rt.from_department_id = fd.id
      JOIN departments td ON rt.to_department_id = td.id
      JOIN categories fc ON rt.from_category_id = fc.id
      JOIN categories tc ON rt.to_category_id = tc.id
      JOIN department_authority_levels fal ON rt.from_authority_level_id = fal.id
      JOIN department_authority_levels tal ON rt.to_authority_level_id = tal.id
      JOIN users u ON rt.initiated_by = u.id
      WHERE rt.request_id = $1 AND rt.status = 'pending'
      LIMIT 1;
    `;
    const res = await db.query(query, [requestId]);
    return res.rows[0] ?? null;
  }

  /**
   * Find a transfer by its ID.
   */
  async findById(
    transferId: string,
    client?: PoolClient,
  ): Promise<RequestTransferRecord | null> {
    const db = client ?? pool;
    const query = `
      SELECT
        rt.id,
        rt.request_id AS "requestId",
        rt.sequence_no AS "sequenceNo",
        rt.from_department_id AS "fromDepartmentId",
        fd.name AS "fromDepartmentName",
        fd.code AS "fromDepartmentCode",
        rt.to_department_id AS "toDepartmentId",
        td.name AS "toDepartmentName",
        td.code AS "toDepartmentCode",
        rt.from_category_id AS "fromCategoryId",
        fc.name AS "fromCategoryName",
        rt.to_category_id AS "toCategoryId",
        tc.name AS "toCategoryName",
        rt.from_authority_level_id AS "fromAuthorityLevelId",
        fal.name AS "fromAuthorityLevelName",
        fal.level_order AS "fromAuthorityLevelOrder",
        rt.to_authority_level_id AS "toAuthorityLevelId",
        tal.name AS "toAuthorityLevelName",
        tal.level_order AS "toAuthorityLevelOrder",
        rt.initiated_by AS "initiatedBy",
        u.full_name AS "initiatorName",
        rt.initiated_assignment_id AS "initiatedAssignmentId",
        rt.reason,
        rt.status,
        rt.decided_by AS "decidedBy",
        du.full_name AS "decidedByName",
        rt.decided_at AS "decidedAt",
        rt.rejection_reason AS "rejectionReason",
        rt.cancellation_reason AS "cancellationReason",
        rt.cancelled_at AS "cancelledAt",
        rt.cancelled_by AS "cancelledBy",
        rt.created_at AS "createdAt",
        rt.updated_at AS "updatedAt"
      FROM request_transfers rt
      JOIN departments fd ON rt.from_department_id = fd.id
      JOIN departments td ON rt.to_department_id = td.id
      JOIN categories fc ON rt.from_category_id = fc.id
      JOIN categories tc ON rt.to_category_id = tc.id
      JOIN department_authority_levels fal ON rt.from_authority_level_id = fal.id
      JOIN department_authority_levels tal ON rt.to_authority_level_id = tal.id
      JOIN users u ON rt.initiated_by = u.id
      LEFT JOIN users du ON rt.decided_by = du.id
      WHERE rt.id = $1;
    `;
    const res = await db.query(query, [transferId]);
    return res.rows[0] ?? null;
  }

  /**
   * Find all transfer attempts for a specific request ordered by sequence_no ASC.
   */
  async findByRequestId(
    requestId: string,
    client?: PoolClient,
  ): Promise<RequestTransferRecord[]> {
    const db = client ?? pool;
    const query = `
      SELECT
        rt.id,
        rt.request_id AS "requestId",
        rt.sequence_no AS "sequenceNo",
        rt.from_department_id AS "fromDepartmentId",
        fd.name AS "fromDepartmentName",
        fd.code AS "fromDepartmentCode",
        rt.to_department_id AS "toDepartmentId",
        td.name AS "toDepartmentName",
        td.code AS "toDepartmentCode",
        rt.from_category_id AS "fromCategoryId",
        fc.name AS "fromCategoryName",
        rt.to_category_id AS "toCategoryId",
        tc.name AS "toCategoryName",
        rt.from_authority_level_id AS "fromAuthorityLevelId",
        fal.name AS "fromAuthorityLevelName",
        fal.level_order AS "fromAuthorityLevelOrder",
        rt.to_authority_level_id AS "toAuthorityLevelId",
        tal.name AS "toAuthorityLevelName",
        tal.level_order AS "toAuthorityLevelOrder",
        rt.initiated_by AS "initiatedBy",
        u.full_name AS "initiatorName",
        rt.initiated_assignment_id AS "initiatedAssignmentId",
        rt.reason,
        rt.status,
        rt.decided_by AS "decidedBy",
        du.full_name AS "decidedByName",
        rt.decided_at AS "decidedAt",
        rt.rejection_reason AS "rejectionReason",
        rt.cancellation_reason AS "cancellationReason",
        rt.cancelled_at AS "cancelledAt",
        rt.cancelled_by AS "cancelledBy",
        rt.created_at AS "createdAt",
        rt.updated_at AS "updatedAt"
      FROM request_transfers rt
      JOIN departments fd ON rt.from_department_id = fd.id
      JOIN departments td ON rt.to_department_id = td.id
      JOIN categories fc ON rt.from_category_id = fc.id
      JOIN categories tc ON rt.to_category_id = tc.id
      JOIN department_authority_levels fal ON rt.from_authority_level_id = fal.id
      JOIN department_authority_levels tal ON rt.to_authority_level_id = tal.id
      JOIN users u ON rt.initiated_by = u.id
      LEFT JOIN users du ON rt.decided_by = du.id
      WHERE rt.request_id = $1
      ORDER BY rt.sequence_no ASC;
    `;
    const res = await db.query(query, [requestId]);
    return res.rows;
  }

  /**
   * Find pending transfers awaiting decision in a target department or across departments for admin.
   */
  async findPendingTransfers(
    options: {
      toDepartmentId?: string;
      page: number;
      limit: number;
    },
    client?: PoolClient,
  ): Promise<{ transfers: RequestTransferRecord[]; total: number }> {
    const db = client ?? pool;
    const values: unknown[] = [];
    let idx = 1;
    let whereClause = `WHERE rt.status = 'pending'`;

    if (options.toDepartmentId) {
      whereClause += ` AND rt.to_department_id = $${idx++}`;
      values.push(options.toDepartmentId);
    }

    const countQuery = `
      SELECT COUNT(*)::int AS count
      FROM request_transfers rt
      ${whereClause};
    `;
    const countRes = await db.query(countQuery, values);
    const total = countRes.rows[0]?.count ?? 0;

    const offset = (options.page - 1) * options.limit;
    values.push(options.limit);
    const limitParam = `$${idx++}`;
    values.push(offset);
    const offsetParam = `$${idx++}`;

    const dataQuery = `
      SELECT
        rt.id,
        rt.request_id AS "requestId",
        rt.sequence_no AS "sequenceNo",
        rt.from_department_id AS "fromDepartmentId",
        fd.name AS "fromDepartmentName",
        fd.code AS "fromDepartmentCode",
        rt.to_department_id AS "toDepartmentId",
        td.name AS "toDepartmentName",
        td.code AS "toDepartmentCode",
        rt.from_category_id AS "fromCategoryId",
        fc.name AS "fromCategoryName",
        rt.to_category_id AS "toCategoryId",
        tc.name AS "toCategoryName",
        rt.from_authority_level_id AS "fromAuthorityLevelId",
        fal.name AS "fromAuthorityLevelName",
        fal.level_order AS "fromAuthorityLevelOrder",
        rt.to_authority_level_id AS "toAuthorityLevelId",
        tal.name AS "toAuthorityLevelName",
        tal.level_order AS "toAuthorityLevelOrder",
        rt.initiated_by AS "initiatedBy",
        u.full_name AS "initiatorName",
        rt.initiated_assignment_id AS "initiatedAssignmentId",
        rt.reason,
        rt.status,
        rt.created_at AS "createdAt",
        r.public_ref AS "publicRef",
        r.title AS "requestTitle",
        r.priority AS "requestPriority"
      FROM request_transfers rt
      JOIN requests r ON rt.request_id = r.id
      JOIN departments fd ON rt.from_department_id = fd.id
      JOIN departments td ON rt.to_department_id = td.id
      JOIN categories fc ON rt.from_category_id = fc.id
      JOIN categories tc ON rt.to_category_id = tc.id
      JOIN department_authority_levels fal ON rt.from_authority_level_id = fal.id
      JOIN department_authority_levels tal ON rt.to_authority_level_id = tal.id
      JOIN users u ON rt.initiated_by = u.id
      ${whereClause}
      ORDER BY rt.created_at ASC
      LIMIT ${limitParam} OFFSET ${offsetParam};
    `;

    const dataRes = await db.query(dataQuery, values);
    const transfers: RequestTransferRecord[] = dataRes.rows.map((row) => ({
      id: row.id,
      requestId: row.requestId,
      sequenceNo: row.sequenceNo,
      fromDepartmentId: row.fromDepartmentId,
      fromDepartmentName: row.fromDepartmentName,
      fromDepartmentCode: row.fromDepartmentCode,
      toDepartmentId: row.toDepartmentId,
      toDepartmentName: row.toDepartmentName,
      toDepartmentCode: row.toDepartmentCode,
      fromCategoryId: row.fromCategoryId,
      fromCategoryName: row.fromCategoryName,
      toCategoryId: row.toCategoryId,
      toCategoryName: row.toCategoryName,
      fromAuthorityLevelId: row.fromAuthorityLevelId,
      fromAuthorityLevelName: row.fromAuthorityLevelName,
      fromAuthorityLevelOrder: row.fromAuthorityLevelOrder,
      toAuthorityLevelId: row.toAuthorityLevelId,
      toAuthorityLevelName: row.toAuthorityLevelName,
      toAuthorityLevelOrder: row.toAuthorityLevelOrder,
      initiatedBy: row.initiatedBy,
      initiatorName: row.initiatorName,
      initiatedAssignmentId: row.initiatedAssignmentId,
      reason: row.reason,
      status: row.status,
      decidedBy: null,
      decidedAt: null,
      rejectionReason: null,
      cancellationReason: null,
      cancelledAt: null,
      cancelledBy: null,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
      request: {
        id: row.requestId,
        publicRef: row.publicRef,
        title: row.requestTitle,
        priority: row.requestPriority,
      },
    }));

    return { transfers, total };
  }

  /**
   * Inserts a new transfer record inside a transaction client.
   */
  async insertTransfer(
    params: {
      requestId: string;
      fromDepartmentId: string;
      toDepartmentId: string;
      fromCategoryId: string;
      toCategoryId: string;
      fromAuthorityLevelId: string;
      toAuthorityLevelId: string;
      initiatedBy: string;
      initiatedAssignmentId: string | null;
      reason: string;
    },
    client: PoolClient,
  ): Promise<RequestTransferRecord> {
    const seqRes = await client.query(
      `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS seq FROM request_transfers WHERE request_id = $1;`,
      [params.requestId],
    );
    const sequenceNo = Number(seqRes.rows[0].seq);

    const insertQuery = `
      INSERT INTO request_transfers (
        request_id,
        sequence_no,
        from_department_id,
        to_department_id,
        from_category_id,
        to_category_id,
        from_authority_level_id,
        to_authority_level_id,
        initiated_by,
        initiated_assignment_id,
        reason,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
      RETURNING id;
    `;

    const res = await client.query(insertQuery, [
      params.requestId,
      sequenceNo,
      params.fromDepartmentId,
      params.toDepartmentId,
      params.fromCategoryId,
      params.toCategoryId,
      params.fromAuthorityLevelId,
      params.toAuthorityLevelId,
      params.initiatedBy,
      params.initiatedAssignmentId,
      params.reason,
    ]);

    const created = await this.findById(res.rows[0].id, client);
    if (!created) {
      throw new Error('Failed to retrieve newly created transfer record');
    }
    return created;
  }
}

export const transferRepository = new TransferRepository();
