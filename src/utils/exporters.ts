import type {
  BirdRecord,
  IngestBatch,
  OperationLog,
  PendingDifference,
  TransferPackage,
  ValidationIssue,
} from '../types'
import { INITIAL_BATCH_NO } from './normalization'

function download(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function pendingDifferenceCountByRecord(differences: PendingDifference[]) {
  const counter = new Map<string, number>()
  differences
    .filter((diff) => diff.status === 'pending')
    .forEach((diff) => counter.set(diff.recordId, (counter.get(diff.recordId) || 0) + 1))
  return counter
}

export function exportRecordsCsv(
  records: BirdRecord[],
  issues: ValidationIssue[],
  differences: PendingDifference[] = [],
) {
  const issueByRecord = new Map<string, ValidationIssue[]>()
  issues
    .filter((issue) => issue.status === 'open')
    .forEach((issue) => {
      issueByRecord.set(issue.recordId, [...(issueByRecord.get(issue.recordId) || []), issue])
    })
  const diffCounter = pendingDifferenceCountByRecord(differences)
  const headers = [
    '记录编号',
    '批次号',
    '内容版本',
    '冻结版本',
    '数据来源',
    '原始文件',
    '原始环号',
    '归一化环号',
    '环志方案',
    '原始鸟种',
    '规范鸟种',
    '学名',
    '观察时间',
    '地点',
    '纬度',
    '经度',
    '环志员',
    '年龄',
    '性别',
    '未解决校验问题',
    '待核对差异条数',
  ]
  const rows = records.map((record) =>
    [
      record.id,
      record.batchNo || INITIAL_BATCH_NO,
      `v${record.version}`,
      record.frozenVersion || '',
      record.source,
      record.sourceFile,
      record.rawRingCode,
      record.normalizedRingCode,
      record.ringScheme,
      record.speciesRaw,
      record.speciesCanonical,
      record.scientificName,
      record.observedAt,
      record.location,
      record.latitude ?? '',
      record.longitude ?? '',
      record.recorder,
      record.ageCode,
      record.sex,
      (issueByRecord.get(record.id) || []).map((issue) => issue.title).join('；'),
      diffCounter.get(record.id) || 0,
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(','),
  )
  download(`\uFEFF${[headers.join(','), ...rows].join('\n')}`, '环志移交数据.csv', 'text/csv;charset=utf-8')
}

export function exportTransferJson(
  records: BirdRecord[],
  issues: ValidationIssue[],
  operations: OperationLog[],
  batches: IngestBatch[] = [],
  packages: TransferPackage[] = [],
  differences: PendingDifference[] = [],
) {
  const diffCounter = pendingDifferenceCountByRecord(differences)
  const pendingDiffCount = differences.filter((diff) => diff.status === 'pending').length
  const payload = {
    schemaVersion: 'CN-RING-2026.1',
    generatedAt: new Date().toISOString(),
    center: '华东区域鸟类环志中心',
    batchReconciliation: {
      initialBatchNo: INITIAL_BATCH_NO,
      batches: batches.map(({ corrections, ...batch }) => ({
        ...batch,
        correctionCount: corrections.length,
        affectedRecords: corrections.map((correction) => correction.recordId),
      })),
      frozenPackages: packages.map(({ records: frozenRecords, issues: frozenIssues, ...pkg }) => ({
        ...pkg,
        recordIds: frozenRecords.map((record) => record.id),
        issueIds: frozenIssues.map((issue) => issue.id),
      })),
      pendingDifferenceCount: pendingDiffCount,
    },
    summary: {
      records: records.length,
      frozenRecords: records.filter((record) => record.frozenVersion).length,
      unresolvedIssues: issues.filter((issue) => issue.status === 'open').length,
      invalidatedIssues: issues.filter((issue) => issue.status === 'invalidated').length,
      correctedIssues: issues.filter((issue) => issue.status === 'corrected').length,
      acceptedIssues: issues.filter((issue) => issue.status === 'accepted').length,
      returnedIssues: issues.filter((issue) => issue.status === 'returned').length,
    },
    records: records.map((record) => ({
      ...record,
      batchNo: record.batchNo || INITIAL_BATCH_NO,
      pendingDifferenceCount: diffCounter.get(record.id) || 0,
    })),
    issues,
    pendingDifferences: differences,
    auditTrail: operations.map(({ snapshot: _snapshot, ...operation }) => operation),
  }
  download(JSON.stringify(payload, null, 2), '环志移交数据.json', 'application/json;charset=utf-8')
}

export function exportValidationCsv(issues: ValidationIssue[], records: BirdRecord[]) {
  const recordsById = new Map(records.map((record) => [record.id, record]))
  const headers = [
    '问题编号',
    '记录编号',
    '批次号',
    '级别',
    '类型',
    '字段',
    '当前值',
    '建议值',
    '状态',
    '失效原因',
    '原人工结论',
    '接续问题',
    '返回原因',
    '原始环号',
    '鸟种',
  ]
  const labels = { error: '错误', warning: '警告', review: '待确认' }
  const statusLabels = {
    open: '待处理',
    accepted: '已接受',
    returned: '已退回',
    corrected: '已修正',
    invalidated: '已失效待重认',
  }
  const previousStatusLabels = {
    accepted: '已接受',
    returned: '已退回',
    corrected: '已修正',
  }
  const rows = issues.map((issue) => {
    const record = recordsById.get(issue.recordId)
    return [
      issue.id,
      issue.recordId,
      issue.batchNo || record?.batchNo || INITIAL_BATCH_NO,
      labels[issue.severity],
      issue.title,
      issue.field,
      issue.currentValue,
      issue.suggestedValue,
      statusLabels[issue.status],
      issue.invalidatedReason || '',
      issue.previousStatus ? previousStatusLabels[issue.previousStatus] : '',
      issue.supersededBy || '',
      issue.returnReason || '',
      record?.rawRingCode || '',
      record?.speciesCanonical || '',
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(',')
  })
  download(`\uFEFF${[headers.join(','), ...rows].join('\n')}`, '校验问题清单.csv', 'text/csv;charset=utf-8')
}

/** 待核对差异清单（冻结记录 vs 后到更正） */
export function exportDifferencesCsv(
  differences: PendingDifference[],
  packages: TransferPackage[],
) {
  const packageNames = new Map(packages.map((pkg) => [pkg.version, pkg.name]))
  const headers = [
    '差异编号',
    '冻结版本',
    '移交包',
    '补交批次',
    '记录编号',
    '字段',
    '冻结值',
    '后到更正值',
    '监测站说明',
    '到达时间',
    '核对状态',
  ]
  const statusLabels = { pending: '待核对', accepted: '已采纳', rejected: '已驳回' }
  const rows = differences.map((diff) =>
    [
      diff.id,
      diff.packageVersion,
      packageNames.get(diff.packageVersion) || '',
      diff.batchNo,
      diff.recordId,
      String(diff.field),
      diff.frozenValue,
      diff.incomingValue,
      diff.reason,
      diff.receivedAt,
      statusLabels[diff.status],
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(','),
  )
  download(`\uFEFF${[headers.join(','), ...rows].join('\n')}`, '待核对差异清单.csv', 'text/csv;charset=utf-8')
}
