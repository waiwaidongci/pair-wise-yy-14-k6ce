import { create } from 'zustand'
import { createMockRecords } from '../data/mockRecords'
import type {
  Batch,
  BirdRecord,
  HandoverPackage,
  IssueSeverity,
  IssueStatus,
  OperationLog,
  RecordDiff,
  ValidationIssue,
} from '../types'
import { applyIssueSuggestion, revalidateRecords, validateRecords } from '../utils/validation'
import { normalizeRecord } from '../utils/normalization'
import {
  computeSupplementaryCorrections,
  fieldLabel,
  formatFieldValue,
  INITIAL_BATCH_ID,
  createInitialBatch,
  nextSupplementaryBatch,
} from '../utils/batches'

const initialRecords = createMockRecords()
const initialIssues = validateRecords(initialRecords)
const initialBatches: Batch[] = [createInitialBatch()]

interface ValidationState {
  records: BirdRecord[]
  issues: ValidationIssue[]
  operations: OperationLog[]
  batches: Batch[]
  packages: HandoverPackage[]
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
  freezePackage: () => void
  applySupplementaryBatch: () => { applied: number; diffed: number; batchId: string }
  resolveDiff: (packageId: string, diffId: string, status: 'accepted' | 'rejected') => void
}

function operation(
  action: OperationLog['action'],
  title: string,
  detail: string,
  count: number,
  snapshot: OperationLog['snapshot'],
): OperationLog {
  return {
    id: crypto.randomUUID(),
    action,
    title,
    detail,
    count,
    timestamp: new Date().toISOString(),
    rolledBack: false,
    snapshot,
  }
}

function fullSnapshot(state: ValidationState): OperationLog['snapshot'] {
  return {
    records: state.records.map((record) => ({ ...record })),
    issues: state.issues.map((issue) => ({ ...issue })),
    packages: state.packages.map((pkg) => ({
      ...pkg,
      records: pkg.records.map((record) => ({ ...record })),
      issues: pkg.issues.map((issue) => ({ ...issue })),
      diffs: pkg.diffs.map((diff) => ({ ...diff })),
    })),
    batches: state.batches.map((batch) => ({ ...batch })),
  }
}

function diffId(recordId: string, field: string) {
  return `diff-${recordId}-${field}`
}

const DIFFABLE_FIELDS: readonly string[] = ['location', 'latitude', 'longitude']

export const useValidationStore = create<ValidationState>((set, get) => ({
  records: initialRecords,
  issues: initialIssues,
  operations: [],
  batches: initialBatches,
  packages: [],
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
    const byRecord = new Map<string, ValidationIssue>()
    candidates.forEach((issue) => byRecord.set(issue.recordId, issue))
    let applied = 0
    let records = state.records.map((record) => {
      const issue = byRecord.get(record.id)
      if (!issue || record.frozenVersion !== null) return record
      applied += 1
      return applyIssueSuggestion(record, issue)
    })
    records = records.map((record) => normalizeRecord(record))
    const issues = revalidateRecords(records, state.issues)
    set({
      records,
      issues,
      operations: [
        operation(
          'batch_fix',
          '按规则批量修正',
          `已处理 ${applied} 条“${candidates[0].title}”问题；冻结记录不参与批量修正。`,
          applied,
          fullSnapshot(state),
        ),
        ...state.operations,
      ],
      selectedIssueIds: [],
    })
    return applied
  },
  acceptIssues: (ids) => {
    const state = get()
    const targetIds = new Set(ids)
    const count = state.issues.filter((issue) => targetIds.has(issue.id) && issue.status === 'open').length
    if (!count) return
    set({
      issues: state.issues.map((issue) =>
        targetIds.has(issue.id) && issue.status === 'open'
          ? { ...issue, status: 'accepted' as IssueStatus }
          : issue,
      ),
      operations: [
        operation(
          'accept',
          '接受校验问题',
          '已确认原记录符合现场情况，问题作为已说明项移交。',
          count,
          fullSnapshot(state),
        ),
        ...state.operations,
      ],
      selectedIssueIds: [],
    })
  },
  returnIssues: (ids, reason) => {
    const state = get()
    const targetIds = new Set(ids)
    const count = state.issues.filter((issue) => targetIds.has(issue.id) && issue.status === 'open').length
    if (!count || !reason.trim()) return
    set({
      issues: state.issues.map((issue) =>
        targetIds.has(issue.id) && issue.status === 'open'
          ? { ...issue, status: 'returned', returnReason: reason.trim() }
          : issue,
      ),
      operations: [
        operation(
          'return',
          '退回来源班组',
          `退回原因：${reason.trim()}`,
          count,
          fullSnapshot(state),
        ),
        ...state.operations,
      ],
      selectedIssueIds: [],
    })
  },
  updateRecord: (recordId, patch, reason) => {
    const state = get()
    const record = state.records.find((item) => item.id === recordId)
    if (!record) return
    if (record.frozenVersion !== null) return
    const records = state.records.map((item) =>
      item.id === recordId ? normalizeRecord({ ...item, ...patch }) : item,
    )
    const issues = revalidateRecords(records, state.issues)
    set({
      records,
      issues,
      operations: [
        operation(
          'manual_edit',
          '人工编辑记录',
          reason.trim() || `修正 ${record.id} 的问题字段。`,
          1,
          fullSnapshot(state),
        ),
        ...state.operations,
      ],
    })
  },
  rollback: (operationId) => {
    const state = get()
    const target = state.operations.find((item) => item.id === operationId)
    if (!target || target.rolledBack) return
    set({
      records: target.snapshot.records.map((record) => ({ ...record })),
      issues: target.snapshot.issues.map((issue) => ({ ...issue })),
      packages: target.snapshot.packages
        ? target.snapshot.packages.map((pkg) => ({
            ...pkg,
            records: pkg.records.map((record) => ({ ...record })),
            issues: pkg.issues.map((issue) => ({ ...issue })),
            diffs: pkg.diffs.map((diff) => ({ ...diff })),
          }))
        : state.packages,
      batches: target.snapshot.batches
        ? target.snapshot.batches.map((batch) => ({ ...batch }))
        : state.batches,
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
      batches: [createInitialBatch()],
      packages: [],
      selectedIssueIds: [],
      selectedRecordIds: [],
    })
  },
  freezePackage: () => {
    const state = get()
    const version = state.packages.length + 1
    const previous = state.packages[0]

    // 以当前记录为底；上一版已确认（accepted）的差异在本版吸收，其余维持冻结值。
    const acceptedByRecord = new Map<string, RecordDiff[]>()
    if (previous) {
      previous.diffs
        .filter((diff) => diff.status === 'accepted')
        .forEach((diff) => {
          acceptedByRecord.set(diff.recordId, [...(acceptedByRecord.get(diff.recordId) || []), diff])
        })
    }
    let records: BirdRecord[] = state.records.map((record) => ({ ...record, frozenVersion: version }))
    if (previous) {
      records = records.map((record) => {
        const diffs = acceptedByRecord.get(record.id)
        if (!diffs?.length) return record
        const patch: Partial<BirdRecord> = {}
        diffs.forEach((diff) => {
          ;(patch as unknown as Record<string, unknown>)[diff.field] = diff.incomingValue
        })
        // 坐标差异需同步写入原始值，normalizeRecord 才能解析出经纬度。
        if (patch.latitude !== undefined) {
          patch.latitudeRaw = Number(patch.latitude).toFixed(5)
          patch.latitude = Number(patch.latitude)
        }
        if (patch.longitude !== undefined) {
          patch.longitudeRaw = Number(patch.longitude).toFixed(5)
          patch.longitude = Number(patch.longitude)
        }
        return normalizeRecord({ ...record, ...patch, frozenVersion: version })
      })
    }

    const issues = revalidateRecords(records, state.issues)

    // 未确认（pending）差异结转到本版，并按新的冻结值刷新待核对原值。
    const carriedDiffs: RecordDiff[] = []
    if (previous) {
      records.forEach((record) => {
        previous.diffs
          .filter((diff) => diff.status === 'pending' && diff.recordId === record.id)
          .forEach((diff) => {
            carriedDiffs.push({
              ...diff,
              id: diffId(record.id, diff.field),
              frozenValue: formatFieldValue(
                diff.field,
                (record as unknown as Record<string, unknown>)[diff.field],
              ),
            })
          })
      })
    }

    const pkg: HandoverPackage = {
      id: `PKG-${version}-${crypto.randomUUID().slice(0, 8)}`,
      version,
      batchId: state.batches[state.batches.length - 1]?.id || INITIAL_BATCH_ID,
      batchLabel: state.batches[state.batches.length - 1]?.label || '初始批次',
      frozenAt: new Date().toISOString(),
      recordCount: records.length,
      records: records.map((record) => ({ ...record })),
      issues: issues.map((issue) => ({ ...issue })),
      diffs: carriedDiffs,
      note:
        version === 1
          ? '首次冻结，记录与问题结论一并封版。'
          : `第 ${version} 版冻结，已吸收上一版确认的更正差异 ${
              previous?.diffs.filter((diff) => diff.status === 'accepted').length ?? 0
            } 条。`,
    }

    set({
      records,
      issues,
      packages: [pkg, ...state.packages],
      operations: [
        operation(
          'freeze',
          `冻结移交包 v${version}`,
          `已冻结 ${records.length.toLocaleString()} 条记录，结转待核对差异 ${carriedDiffs.length} 条。`,
          records.length,
          fullSnapshot(state),
        ),
        ...state.operations,
      ],
      selectedIssueIds: [],
      selectedRecordIds: [],
    })
  },
  applySupplementaryBatch: () => {
    const state = get()
    const corrections = computeSupplementaryCorrections(state.records)
    if (!corrections.length) return { applied: 0, diffed: 0, batchId: '' }
    const batch = nextSupplementaryBatch(state.batches)
    const correctionMap = new Map(corrections.map((item) => [item.recordId, item.patch]))
    const frozenPkg = state.packages[0]

    let applied = 0
    let diffed = 0
    const diffsByPackage = new Map<string, RecordDiff[]>()

    const records = state.records.map((record) => {
      const patch = correctionMap.get(record.id)
      if (!patch) return record
      if (record.frozenVersion !== null && frozenPkg) {
        // 已冻结：不吸收后到更正，只登记待核对差异。
        const frozenRecord = frozenPkg.records.find((item) => item.id === record.id)
        const existing = frozenPkg.diffs.filter(
          (diff) => diff.recordId === record.id && diff.status === 'pending',
        )
        const nextDiffs: RecordDiff[] = []
        Object.entries(patch).forEach(([field, incomingValue]) => {
          if (!DIFFABLE_FIELDS.includes(field)) return
          const prev = existing.find((diff) => diff.field === field)
          const frozenValue = frozenRecord
            ? formatFieldValue(field, (frozenRecord as unknown as Record<string, unknown>)[field])
            : formatFieldValue(field, (record as unknown as Record<string, unknown>)[field])
          nextDiffs.push({
            id: diffId(record.id, field),
            recordId: record.id,
            field,
            fieldLabel: fieldLabel(field),
            frozenValue,
            incomingValue: formatFieldValue(field, incomingValue),
            status: 'pending',
            detectedAt: new Date().toISOString(),
          })
          if (!prev) diffed += 1
        })
        diffsByPackage.set(frozenPkg.id, [
          ...(diffsByPackage.get(frozenPkg.id) || []),
          ...nextDiffs,
        ])
        return record
      }
      applied += 1
      return normalizeRecord({ ...record, ...patch, batchId: batch.id })
    })

    const issues = revalidateRecords(records, state.issues)
    const packages = state.packages.map((pkg) => {
      const additions = diffsByPackage.get(pkg.id)
      if (!additions?.length) return pkg
      const pending = pkg.diffs.filter((diff) => diff.status === 'pending')
      const resolved = pkg.diffs.filter((diff) => diff.status !== 'pending')
      const merged = new Map<string, RecordDiff>()
      pending.forEach((diff) => merged.set(diff.id, diff))
      additions.forEach((diff) => merged.set(diff.id, diff))
      return { ...pkg, diffs: [...resolved, ...merged.values()] }
    })

    set({
      records,
      issues,
      packages,
      batches: [...state.batches, batch],
      operations: [
        operation(
          'supplement',
          '收到补交更正批次',
          `批次 ${batch.id}：${applied} 条已吸收并重新校验，${diffed} 条已冻结仅列差异。`,
          applied + diffed,
          fullSnapshot(state),
        ),
        ...state.operations,
      ],
    })
    return { applied, diffed, batchId: batch.id }
  },
  resolveDiff: (packageId, diffId, status) => {
    const state = get()
    const pkg = state.packages.find((item) => item.id === packageId)
    if (!pkg) return
    const diff = pkg.diffs.find((item) => item.id === diffId)
    if (!diff || diff.status !== 'pending') return
    const packages = state.packages.map((item) =>
      item.id === packageId
        ? {
            ...item,
            diffs: item.diffs.map((entry) =>
              entry.id === diffId ? { ...entry, status } : entry,
            ),
          }
        : item,
    )
    set({
      packages,
      operations: [
        operation(
          'diff_resolve',
          status === 'accepted' ? '确认补交差异' : '驳回补交差异',
          `${diff.recordId} 的${diff.fieldLabel}：${diff.frozenValue} → ${diff.incomingValue}`,
          1,
          fullSnapshot(state),
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
