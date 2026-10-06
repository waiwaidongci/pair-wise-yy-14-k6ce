import type { Batch, BirdRecord, HandoverPackage, OperationLog, ValidationIssue } from '../types'
import { INITIAL_BATCH_ID } from '../utils/batches'

function download(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function latestPackage(packages?: HandoverPackage[]) {
  return packages?.[0]
}

function pendingDiffCountByRecord(pkg?: HandoverPackage) {
  const map = new Map<string, number>()
  pkg?.diffs
    .filter((diff) => diff.status === 'pending')
    .forEach((diff) => map.set(diff.recordId, (map.get(diff.recordId) || 0) + 1))
  return map
}

export function exportRecordsCsv(
  records: BirdRecord[],
  issues: ValidationIssue[],
  packages?: HandoverPackage[],
) {
  const issueByRecord = new Map<string, ValidationIssue[]>()
  issues
    .filter((issue) => issue.status === 'open')
    .forEach((issue) => {
      issueByRecord.set(issue.recordId, [...(issueByRecord.get(issue.recordId) || []), issue])
    })
  const diffCountByRecord = pendingDiffCountByRecord(latestPackage(packages))
  const headers = [
    '记录编号',
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
    '批次号',
    '冻结版本',
    '待核对差异条数',
  ]
  const rows = records.map((record) =>
    [
      record.id,
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
      record.batchId || INITIAL_BATCH_ID,
      record.frozenVersion ? `v${record.frozenVersion}` : '未冻结',
      diffCountByRecord.get(record.id) || 0,
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(','),
  )
  download(`﻿${[headers.join(','), ...rows].join('\n')}`, '环志移交数据.csv', 'text/csv;charset=utf-8')
}

export function exportTransferJson(
  records: BirdRecord[],
  issues: ValidationIssue[],
  operations: OperationLog[],
  packages?: HandoverPackage[],
  batches?: Batch[],
) {
  const pkg = latestPackage(packages)
  const pendingDiffs = pkg?.diffs.filter((diff) => diff.status === 'pending') || []
  const acceptedDiffs = pkg?.diffs.filter((diff) => diff.status === 'accepted') || []
  const rejectedDiffs = pkg?.diffs.filter((diff) => diff.status === 'rejected') || []
  const payload = {
    schemaVersion: 'CN-RING-2026.1',
    generatedAt: new Date().toISOString(),
    center: '华东区域鸟类环志中心',
    batch: pkg
      ? { id: pkg.batchId, label: pkg.batchLabel, frozenVersion: pkg.version }
      : batches?.length
        ? {
            id: batches[batches.length - 1].id,
            label: batches[batches.length - 1].label,
            frozenVersion: null,
          }
        : { id: INITIAL_BATCH_ID, label: '初始批次', frozenVersion: null },
    frozenPackage: pkg
      ? {
          version: pkg.version,
          frozenAt: pkg.frozenAt,
          recordCount: pkg.recordCount,
          batchId: pkg.batchId,
        }
      : null,
    summary: {
      records: records.length,
      unresolvedIssues: issues.filter((issue) => issue.status === 'open').length,
      correctedIssues: issues.filter((issue) => issue.status === 'corrected').length,
      acceptedIssues: issues.filter((issue) => issue.status === 'accepted').length,
      returnedIssues: issues.filter((issue) => issue.status === 'returned').length,
      frozenVersion: pkg?.version ?? null,
      frozenRecords: pkg?.recordCount ?? 0,
      diffCount: pendingDiffs.length,
      acceptedDiffs: acceptedDiffs.length,
      rejectedDiffs: rejectedDiffs.length,
    },
    pendingDiffs,
    records,
    issues,
    auditTrail: operations.map(({ snapshot: _snapshot, ...operation }) => operation),
  }
  download(JSON.stringify(payload, null, 2), '环志移交数据.json', 'application/json;charset=utf-8')
}

export function exportValidationCsv(
  issues: ValidationIssue[],
  records: BirdRecord[],
  packages?: HandoverPackage[],
) {
  const recordsById = new Map(records.map((record) => [record.id, record]))
  const diffCountByRecord = pendingDiffCountByRecord(latestPackage(packages))
  const headers = [
    '问题编号',
    '记录编号',
    '级别',
    '类型',
    '字段',
    '当前值',
    '建议值',
    '状态',
    '返回原因',
    '原始环号',
    '鸟种',
    '批次号',
    '冻结版本',
    '待核对差异条数',
  ]
  const labels = { error: '错误', warning: '警告', review: '待确认' }
  const statusLabels = {
    open: '待处理',
    accepted: '已接受',
    returned: '已退回',
    corrected: '已修正',
  }
  const rows = issues.map((issue) => {
    const record = recordsById.get(issue.recordId)
    return [
      issue.id,
      issue.recordId,
      labels[issue.severity],
      issue.title,
      issue.field,
      issue.currentValue,
      issue.suggestedValue,
      statusLabels[issue.status],
      issue.returnReason || '',
      record?.rawRingCode || '',
      record?.speciesCanonical || '',
      record?.batchId || INITIAL_BATCH_ID,
      record?.frozenVersion ? `v${record.frozenVersion}` : '未冻结',
      diffCountByRecord.get(issue.recordId) || 0,
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(',')
  })
  download(`﻿${[headers.join(','), ...rows].join('\n')}`, '校验问题清单.csv', 'text/csv;charset=utf-8')
}
