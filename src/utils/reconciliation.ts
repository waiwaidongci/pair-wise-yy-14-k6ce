import type {
  BirdRecord,
  IngestBatch,
  PendingDifference,
  TransferPackage,
  ValidationIssue,
} from '../types'
import { normalizeRecord, parseCoordinate } from './normalization'
import {
  buildLocationJumpIssue,
  buildSpeciesIssue,
  findPreviousSameRingRecord,
  getJumpInfo,
  isLocationJump,
} from './validation'

const COORDINATE_FIELDS: (keyof BirdRecord)[] = ['latitudeRaw', 'longitudeRaw']
const SPECIES_FIELDS: (keyof BirdRecord)[] = ['speciesRaw']

export interface IngestResult {
  records: BirdRecord[]
  issues: ValidationIssue[]
  differences: PendingDifference[]
  affectedRecordIds: string[]
  frozenRecordIds: string[]
}

function nextIssueId(existing: ValidationIssue[], prefix: string): string {
  let suffix = 1
  const used = new Set(existing.map((issue) => issue.id))
  while (used.has(`${prefix}-r${suffix}`)) suffix += 1
  return `${prefix}-r${suffix}`
}

function invalidateIssue(issue: ValidationIssue, reason: string, at: string): ValidationIssue {
  if (issue.status === 'invalidated') return issue
  return {
    ...issue,
    status: 'invalidated',
    // 人工已接受/退回的结论在失效时留痕，不被静默冲掉
    previousStatus: issue.status === 'open' ? undefined : (issue.status as ValidationIssue['previousStatus']),
    invalidatedAt: at,
    invalidatedReason: reason,
  }
}

function coordinatesValid(record: BirdRecord): boolean {
  return (
    parseCoordinate(record.latitudeRaw, 'latitude') !== null &&
    parseCoordinate(record.longitudeRaw, 'longitude') !== null
  )
}

/**
 * 并入一个补交/更正批次：
 * - 未冻结记录吸收更正：坐标改动先让坐标类/跳变问题失效，再按新值重新确认；
 * - 已冻结记录不吸收更正，只生成“待核对差异”，原接受/退回结论保留在冻结包内。
 */
export function ingestCorrectionBatch(
  records: BirdRecord[],
  issues: ValidationIssue[],
  existingDifferences: PendingDifference[],
  batch: IngestBatch,
): IngestResult {
  const at = new Date().toISOString()
  const correctionsByRecord = new Map(batch.corrections.map((item) => [item.recordId, item]))
  const recordById = new Map(records.map((record) => [record.id, record]))
  const affectedRecordIds = batch.corrections.map((item) => item.recordId)

  // —— 已冻结记录：只列待核对差异，不覆盖冻结值 ——
  const frozenRecordIds = affectedRecordIds.filter((id) => Boolean(recordById.get(id)?.frozenVersion))
  const frozenSet = new Set(frozenRecordIds)
  const differences = [...existingDifferences]
  frozenRecordIds.forEach((recordId) => {
    const record = recordById.get(recordId)!
    const correction = correctionsByRecord.get(recordId)!
    Object.entries(correction.fields).forEach(([field, incoming]) => {
      const key = field as keyof BirdRecord
      const frozenValue = String(record[key] ?? '')
      const incomingValue = String(incoming ?? '')
      if (frozenValue === incomingValue) return
      differences.push({
        id: `diff_${recordId}_${String(key)}_${batch.batchNo}`,
        packageVersion: record.frozenVersion,
        batchNo: batch.batchNo,
        recordId,
        field: key,
        frozenValue,
        incomingValue,
        reason: correction.reason,
        receivedAt: batch.receivedAt,
        status: 'pending',
      })
    })
  })

  // —— 未冻结记录：吸收更正，版本递增 ——
  const nextRecords = records.map((record) => {
    const correction = correctionsByRecord.get(record.id)
    if (!correction || frozenSet.has(record.id)) return record
    return {
      ...normalizeRecord({ ...record, ...correction.fields }),
      batchNo: batch.batchNo,
      version: record.version + 1,
      batchHistory: [...record.batchHistory, batch.batchNo],
    }
  })

  const physicalCoordChanged = new Set<string>()
  const speciesChanged = new Set<string>()
  correctionsByRecord.forEach((correction, recordId) => {
    if (frozenSet.has(recordId)) return
    const before = recordById.get(recordId)
    const after = nextRecords.find((item) => item.id === recordId)
    if (!before || !after) return
    const fields = Object.keys(correction.fields) as (keyof BirdRecord)[]
    const actuallyChanged = (field: keyof BirdRecord) => before[field] !== after[field]
    if (fields.some((field) => COORDINATE_FIELDS.includes(field) && actuallyChanged(field))) {
      physicalCoordChanged.add(recordId)
    }
    if (fields.some((field) => SPECIES_FIELDS.includes(field) && actuallyChanged(field))) {
      speciesChanged.add(recordId)
    }
  })

  // 跳变问题还依赖“同环号上一条”：上一条坐标变了，本条跳变也要重新确认。
  // 集合统一存记录 id。
  const jumpReevaluate = new Set<string>(physicalCoordChanged)
  nextRecords.forEach((record, index) => {
    const previous = findPreviousSameRingRecord(nextRecords, index)
    if (previous && physicalCoordChanged.has(previous.id)) jumpReevaluate.add(record.id)
  })

  // —— 失效旧问题（保留人工结论痕迹） ——
  let nextIssues = issues.map((issue) => {
    if (issue.status === 'invalidated') return issue
    if (
      physicalCoordChanged.has(issue.recordId) &&
      (issue.type === 'coordinate_invalid' || issue.type === 'location_jump')
    ) {
      return invalidateIssue(issue, `批次 ${batch.batchNo} 更正坐标，原判定依据已变化`, at)
    }
    if (jumpReevaluate.has(issue.recordId) && issue.type === 'location_jump') {
      return invalidateIssue(issue, `批次 ${batch.batchNo} 更正同环号关联记录坐标，原跳变依据已变化`, at)
    }
    if (
      speciesChanged.has(issue.recordId) &&
      (issue.type === 'species_alias' || issue.type === 'species_unknown')
    ) {
      return invalidateIssue(issue, `批次 ${batch.batchNo} 更正鸟种，原判定依据已变化`, at)
    }
    return issue
  })

  const linkReplacement = (oldIssue: ValidationIssue | undefined, newId: string) => {
    if (!oldIssue) return
    nextIssues = nextIssues.map((issue) =>
      issue.id === oldIssue.id ? { ...issue, supersededBy: newId } : issue,
    )
  }
  const closeReconfirmed = (oldIssue: ValidationIssue | undefined) => {
    // 新值下问题不再成立，旧问题保持 invalidated 并记录“已按新值复核通过”
    if (!oldIssue) return
    nextIssues = nextIssues.map((issue) =>
      issue.id === oldIssue.id
        ? { ...issue, invalidatedReason: `${issue.invalidatedReason}；按新值复核不再成立` }
        : issue,
    )
  }

  // —— 按新值重新确认坐标类问题 ——
  jumpReevaluate.forEach((recordId) => {
    const record = nextRecords.find((item) => item.id === recordId)
    if (!record) return
    const index = nextRecords.indexOf(record)

    const oldCoordinate = nextIssues.find(
      (issue) => issue.recordId === recordId && issue.type === 'coordinate_invalid' && issue.status === 'invalidated',
    )
    const liveCoordinate = nextIssues.some(
      (issue) => issue.recordId === recordId && issue.type === 'coordinate_invalid' && issue.status !== 'invalidated',
    )
    if (physicalCoordChanged.has(recordId) && !coordinatesValid(record) && !liveCoordinate) {
      const id = nextIssueId(nextIssues, `issue-coordinate-${recordId}`)
      nextIssues.push({
        id,
        recordId,
        type: 'coordinate_invalid',
        severity: 'error',
        title: '坐标格式无效',
        description: `纬度“${record.latitudeRaw}”、经度“${record.longitudeRaw}”不能同时转换为有效坐标。`,
        field: 'latitudeRaw',
        currentValue: `${record.latitudeRaw} / ${record.longitudeRaw}`,
        suggestedValue: '',
        suggestion: '根据地点主表补齐十进制度数或标准度分秒格式。',
        status: 'open',
        detectedAt: at,
        batchNo: batch.batchNo,
        reopenedFrom: oldCoordinate?.id,
      })
      linkReplacement(oldCoordinate, id)
    } else if (oldCoordinate && coordinatesValid(record)) {
      closeReconfirmed(oldCoordinate)
    }

    const oldJump = nextIssues.find(
      (issue) => issue.recordId === recordId && issue.type === 'location_jump' && issue.status === 'invalidated',
    )
    const liveJump = nextIssues.some(
      (issue) => issue.recordId === recordId && issue.type === 'location_jump' && issue.status !== 'invalidated',
    )
    const previous = findPreviousSameRingRecord(nextRecords, index)
    const info = previous ? getJumpInfo(record, previous) : null
    if (isLocationJump(info) && previous && !liveJump) {
      const id = nextIssueId(nextIssues, `issue-jump-${recordId}`)
      nextIssues.push(
        buildLocationJumpIssue(record, previous, info, at, {
          id,
          batchNo: batch.batchNo,
          reopenedFrom: oldJump?.id,
        }),
      )
      linkReplacement(oldJump, id)
    } else if (oldJump && !isLocationJump(info)) {
      closeReconfirmed(oldJump)
    }
  })

  // —— 按新值重新确认鸟种问题 ——
  speciesChanged.forEach((recordId) => {
    const record = nextRecords.find((item) => item.id === recordId)
    if (!record) return
    const old = nextIssues.find(
      (issue) =>
        issue.recordId === recordId &&
        (issue.type === 'species_alias' || issue.type === 'species_unknown') &&
        issue.status === 'invalidated',
    )
    const live = nextIssues.some(
      (issue) =>
        issue.recordId === recordId &&
        (issue.type === 'species_alias' || issue.type === 'species_unknown') &&
        issue.status !== 'invalidated',
    )
    const fresh = buildSpeciesIssue(record, at)
    if (fresh && !live) {
      const id = nextIssueId(nextIssues, `issue-species-${recordId}`)
      nextIssues.push({ ...fresh, id, batchNo: batch.batchNo, reopenedFrom: old?.id })
      linkReplacement(old, id)
    } else if (old && !fresh) {
      closeReconfirmed(old)
    }
  })

  return {
    records: nextRecords,
    issues: nextIssues,
    differences,
    affectedRecordIds,
    frozenRecordIds,
  }
}

/** 冻结当前全部未冻结记录到一个移交包版本 */
export function buildTransferPackage(
  records: BirdRecord[],
  issues: ValidationIssue[],
  version: string,
  name: string,
  note: string,
): { pkg: TransferPackage; records: BirdRecord[] } {
  const frozenAt = new Date().toISOString()
  const unfrozen = records.filter((record) => !record.frozenVersion)
  const unfrozenIds = new Set(unfrozen.map((record) => record.id))
  const pkg: TransferPackage = {
    version,
    name,
    frozenAt,
    note,
    recordCount: unfrozen.length,
    issueCount: issues.filter((issue) => unfrozenIds.has(issue.recordId)).length,
    records: unfrozen.map((record) => ({ ...record, frozenVersion: version })),
    issues: issues.filter((issue) => unfrozenIds.has(issue.recordId)).map((issue) => ({ ...issue })),
    pendingDifferenceCount: 0,
    pendingDifferenceBatches: [],
  }
  const nextRecords = records.map((record) => (record.frozenVersion ? record : { ...record, frozenVersion: version }))
  return { pkg, records: nextRecords }
}

/** 把后到差异条数回写到各冻结包元数据 */
export function refreshPackageDifferenceCounters(
  packages: TransferPackage[],
  differences: PendingDifference[],
): TransferPackage[] {
  return packages.map((pkg) => {
    const pending = differences.filter(
      (diff) => diff.packageVersion === pkg.version && diff.status === 'pending',
    )
    return {
      ...pkg,
      pendingDifferenceCount: pending.length,
      pendingDifferenceBatches: [...new Set(pending.map((diff) => diff.batchNo))],
    }
  })
}
