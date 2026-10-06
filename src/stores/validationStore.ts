import { create } from 'zustand'
import { PENDING_INGEST_BATCHES } from '../data/ingestBatches'
import { createMockRecords } from '../data/mockRecords'
import type {
  BirdRecord,
  IngestBatch,
  IssueSeverity,
  IssueStatus,
  OperationLog,
  OperationSnapshot,
  PendingDifference,
  TransferPackage,
  ValidationIssue,
} from '../types'
import { INITIAL_BATCH_NO } from '../utils/normalization'
import {
  buildTransferPackage,
  ingestCorrectionBatch,
  refreshPackageDifferenceCounters,
} from '../utils/reconciliation'
import { applyIssueSuggestion, sortIssues, validateRecords } from '../utils/validation'
import { normalizeRecord } from '../utils/normalization'

const initialRecords = createMockRecords()
const initialIssues = validateRecords(initialRecords)

interface ValidationState {
  records: BirdRecord[]
  issues: ValidationIssue[]
  operations: OperationLog[]
  batches: IngestBatch[]
  packages: TransferPackage[]
  differences: PendingDifference[]
  selectedIssueIds: string[]
  selectedRecordIds: string[]
  setSelectedIssueIds: (ids: string[]) => void
  setSelectedRecordIds: (ids: string[]) => void
  batchFix: (type: ValidationIssue['type']) => number
  acceptIssues: (ids: string[]) => void
  returnIssues: (ids: string[], reason: string) => void
  updateRecord: (recordId: string, patch: Partial<BirdRecord>, reason: string) => void
  rollback: (operationId: string) => void
  reset: () => void
  ingestBatch: (batchNo: string) => { ingested: number; frozen: number; differences: number }
  freezePackage: (name: string, note: string) => string | null
  reviewDifference: (differenceId: string, status: 'accepted' | 'rejected', note: string) => void
}

function takeSnapshot(state: ValidationState): OperationSnapshot {
  return {
    records: state.records.map((record) => ({ ...record })),
    issues: state.issues.map((issue) => ({ ...issue })),
    batches: state.batches.map((batch) => ({ ...batch, corrections: batch.corrections.map((c) => ({ ...c, fields: { ...c.fields } })) })),
    packages: state.packages.map((pkg) => ({ ...pkg })),
    differences: state.differences.map((diff) => ({ ...diff })),
  }
}

function makeOperation(
  action: OperationLog['action'],
  title: string,
  detail: string,
  count: number,
  snapshot: OperationSnapshot,
  frozenSince?: string,
): OperationLog {
  return {
    id: crypto.randomUUID(),
    action,
    title,
    detail,
    count,
    timestamp: new Date().toISOString(),
    rolledBack: false,
    frozenSince,
    snapshot,
  }
}

/** 冻结移交包一旦生成，其时刻及之后的处置历史不允许回滚 */
function currentProtectedVersion(packages: TransferPackage[]): string {
  if (!packages.length) return ''
  return packages.reduce((earliest, pkg) => (pkg.frozenAt < earliest ? pkg.frozenAt : earliest), packages[0].frozenAt)
}

export const useValidationStore = create<ValidationState>((set, get) => ({
  records: initialRecords,
  issues: initialIssues,
  operations: [],
  batches: PENDING_INGEST_BATCHES.map((batch) => ({
    ...batch,
    corrections: batch.corrections.map((correction) => ({ ...correction, fields: { ...correction.fields } })),
  })),
  packages: [],
  differences: [],
  selectedIssueIds: [],
  selectedRecordIds: [],
  setSelectedIssueIds: (ids) => set({ selectedIssueIds: ids }),
  setSelectedRecordIds: (ids) => set({ selectedRecordIds: ids }),
  batchFix: (type) => {
    const state = get()
    const candidates = state.issues.filter(
      (issue) => issue.type === type && issue.status === 'open' && issue.suggestedValue,
    )
    if (!candidates.length) return 0
    const snapshot = takeSnapshot(state)
    const byRecord = new Map<string, ValidationIssue>()
    candidates.forEach((issue) => byRecord.set(issue.recordId, issue))
    const records = state.records.map((record) => {
      const issue = byRecord.get(record.id)
      return issue && !record.frozenVersion ? applyIssueSuggestion(record, issue) : record
    })
    const targetIds = new Set(
      candidates.filter((issue) => !state.records.find((r) => r.id === issue.recordId)?.frozenVersion).map((issue) => issue.id),
    )
    const issues = state.issues.map((issue) =>
      targetIds.has(issue.id) ? { ...issue, status: 'corrected' as const } : issue,
    )
    set({
      records,
      issues,
      operations: [
        makeOperation(
          'batch_fix',
          '按规则批量修正',
          `已处理 ${targetIds.size} 条“${candidates[0].title}”问题。`,
          targetIds.size,
          snapshot,
          currentProtectedVersion(state.packages),
        ),
        ...state.operations,
      ],
      selectedIssueIds: [],
    })
    return targetIds.size
  },
  acceptIssues: (ids) => {
    const state = get()
    const targetIds = new Set(ids)
    const frozenIds = new Set(
      state.records.filter((record) => record.frozenVersion).map((record) => record.id),
    )
    const count = state.issues.filter(
      (issue) => targetIds.has(issue.id) && issue.status === 'open' && !frozenIds.has(issue.recordId),
    ).length
    if (!count) return
    const snapshot = takeSnapshot(state)
    set({
      issues: state.issues.map((issue) =>
        targetIds.has(issue.id) && issue.status === 'open' && !frozenIds.has(issue.recordId)
          ? { ...issue, status: 'accepted' as IssueStatus }
          : issue,
      ),
      operations: [
        makeOperation(
          'accept',
          '接受校验问题',
          '已确认原记录符合现场情况，问题作为已说明项移交。',
          count,
          snapshot,
          currentProtectedVersion(state.packages),
        ),
        ...state.operations,
      ],
      selectedIssueIds: [],
    })
  },
  returnIssues: (ids, reason) => {
    const state = get()
    const targetIds = new Set(ids)
    const frozenIds = new Set(
      state.records.filter((record) => record.frozenVersion).map((record) => record.id),
    )
    const count = state.issues.filter(
      (issue) => targetIds.has(issue.id) && issue.status === 'open' && !frozenIds.has(issue.recordId),
    ).length
    if (!count || !reason.trim()) return
    const snapshot = takeSnapshot(state)
    set({
      issues: state.issues.map((issue) =>
        targetIds.has(issue.id) && issue.status === 'open' && !frozenIds.has(issue.recordId)
          ? { ...issue, status: 'returned', returnReason: reason.trim() }
          : issue,
      ),
      operations: [
        makeOperation(
          'return',
          '退回来源班组',
          `退回原因：${reason.trim()}`,
          count,
          snapshot,
          currentProtectedVersion(state.packages),
        ),
        ...state.operations,
      ],
      selectedIssueIds: [],
    })
  },
  updateRecord: (recordId, patch, reason) => {
    const state = get()
    const record = state.records.find((item) => item.id === recordId)
    if (!record || record.frozenVersion) return
    const snapshot = takeSnapshot(state)
    set({
      records: state.records.map((item) =>
        item.id === recordId ? normalizeRecord({ ...item, ...patch }) : item,
      ),
      issues: state.issues.map((issue) =>
        issue.recordId === recordId && issue.status === 'open'
          ? { ...issue, status: 'corrected' }
          : issue,
      ),
      operations: [
        makeOperation(
          'manual_edit',
          '人工编辑记录',
          reason.trim() || `修正 ${record.id} 的问题字段。`,
          1,
          snapshot,
          currentProtectedVersion(state.packages),
        ),
        ...state.operations,
      ],
    })
  },
  rollback: (operationId) => {
    const state = get()
    const target = state.operations.find((item) => item.id === operationId)
    if (!target || target.rolledBack || target.frozenSince) return
    // 一旦存在冻结移交包，整条处置历史都属于冻结审计链路，不可回滚
    if (state.packages.length) return
    const snapshot = target.snapshot
    set({
      records: snapshot.records.map((record) => ({ ...record })),
      issues: snapshot.issues.map((issue) => ({ ...issue })),
      batches: snapshot.batches.map((batch) => ({ ...batch })),
      packages: snapshot.packages.map((pkg) => ({ ...pkg })),
      differences: snapshot.differences.map((diff) => ({ ...diff })),
      operations: state.operations.map((item) =>
        item.id === operationId ? { ...item, rolledBack: true } : item,
      ),
      selectedIssueIds: [],
      selectedRecordIds: [],
    })
  },
  reset: () => {
    const records = createMockRecords()
    set({
      records,
      issues: validateRecords(records),
      operations: [],
      batches: PENDING_INGEST_BATCHES.map((batch) => ({
        ...batch,
        corrections: batch.corrections.map((correction) => ({ ...correction, fields: { ...correction.fields } })),
      })),
      packages: [],
      differences: [],
      selectedIssueIds: [],
      selectedRecordIds: [],
    })
  },
  ingestBatch: (batchNo) => {
    const state = get()
    const batch = state.batches.find((item) => item.batchNo === batchNo)
    if (!batch || batch.status === 'ingested') return { ingested: 0, frozen: 0, differences: 0 }
    const snapshot = takeSnapshot(state)
    const result = ingestCorrectionBatch(
      state.records,
      state.issues,
      state.differences,
      { ...batch, status: 'ingested', ingestedAt: new Date().toISOString() },
    )
    const packages = refreshPackageDifferenceCounters(state.packages, result.differences)
    const frozenCount = result.frozenRecordIds.length
    const ingestedCount = result.affectedRecordIds.length - frozenCount
    const newDiffCount =
      result.differences.length - state.differences.length
    set({
      records: result.records,
      issues: sortIssues(result.issues),
      differences: result.differences,
      packages,
      batches: state.batches.map((item) =>
        item.batchNo === batchNo ? { ...item, status: 'ingested', ingestedAt: new Date().toISOString() } : item,
      ),
      operations: [
        makeOperation(
          'ingest',
          `并入补交批次 ${batchNo}`,
          frozenCount
            ? `批次来自${batch.source}：更正 ${ingestedCount} 条未冻结记录；${frozenCount} 条已冻结记录不吸收更正，新增 ${newDiffCount} 条待核对差异。`
            : `批次来自${batch.source}：更正 ${ingestedCount} 条记录；依赖坐标/鸟种的问题已先失效并按新值重新确认。`,
          result.affectedRecordIds.length,
          snapshot,
          currentProtectedVersion(state.packages),
        ),
        ...state.operations,
      ],
      selectedIssueIds: [],
    })
    return { ingested: ingestedCount, frozen: frozenCount, differences: newDiffCount }
  },
  freezePackage: (name, note) => {
    const state = get()
    const unfrozen = state.records.filter((record) => !record.frozenVersion)
    if (!unfrozen.length) return null
    const version = `PKG-2026.1-v${state.packages.length + 1}`
    const snapshot = takeSnapshot(state)
    const { pkg, records } = buildTransferPackage(state.records, state.issues, version, name, note)
    set({
      records,
      packages: [...state.packages, pkg],
      operations: [
        makeOperation(
          'freeze',
          `冻结移交包 ${version}`,
          `“${name}”冻结 ${pkg.recordCount} 条记录、${pkg.issueCount} 条问题及当时处置结论；此后到达的更正只列为待核对差异。`,
          pkg.recordCount,
          snapshot,
          version,
        ),
        ...state.operations,
      ],
      selectedIssueIds: [],
      selectedRecordIds: [],
    })
    return version
  },
  reviewDifference: (differenceId, reviewStatus, note) => {
    const state = get()
    const target = state.differences.find((item) => item.id === differenceId)
    if (!target || target.status !== 'pending') return
    const snapshot = takeSnapshot(state)
    const differences = state.differences.map((item) =>
      item.id === differenceId
        ? {
            ...item,
            status: reviewStatus,
            reviewedAt: new Date().toISOString(),
            reviewNote: note.trim(),
          }
        : item,
    )
    set({
      differences,
      packages: refreshPackageDifferenceCounters(state.packages, differences),
      operations: [
        makeOperation(
          'diff_review',
          reviewStatus === 'accepted' ? '采纳待核对差异' : '驳回待核对差异',
          `记录 ${target.recordId} 字段 ${String(target.field)}（批次 ${target.batchNo}，冻结包 ${target.packageVersion}）：${note.trim() || '（未填写说明）'}`,
          1,
          snapshot,
          target.packageVersion,
        ),
        ...state.operations,
      ],
    })
  },
}))

export function filterIssues(
  issues: ValidationIssue[],
  filters: {
    severity?: IssueSeverity | 'all'
    status?: IssueStatus | 'all'
    type?: ValidationIssue['type'] | 'all'
    keyword?: string
  },
) {
  const keyword = filters.keyword?.trim().toLowerCase()
  return issues.filter((issue) => {
    if (filters.severity && filters.severity !== 'all' && issue.severity !== filters.severity) return false
    if (filters.status && filters.status !== 'all' && issue.status !== filters.status) return false
    if (filters.type && filters.type !== 'all' && issue.type !== filters.type) return false
    if (
      keyword &&
      !issue.recordId.toLowerCase().includes(keyword) &&
      !issue.title.toLowerCase().includes(keyword) &&
      !issue.description.toLowerCase().includes(keyword)
    )
      return false
    return true
  })
}

export { INITIAL_BATCH_NO }
