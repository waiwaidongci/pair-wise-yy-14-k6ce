import type { BirdRecord, IssueSeverity, IssueStatus, IssueType, ValidationIssue } from '../types'
import { getLocationDistance } from '../data/mockRecords'
import { normalizeRingCode, parseCoordinate } from './normalization'

const SEVERITY_ORDER: Record<IssueSeverity, number> = {
  error: 0,
  warning: 1,
  review: 2,
}

function issueBasis(type: IssueType, record: BirdRecord, previous?: BirdRecord): string {
  switch (type) {
    case 'ring_invalid':
      return `rawRingCode=${record.rawRingCode}`
    case 'ring_duplicate':
      return `normalizedRingCode=${record.normalizedRingCode}`
    case 'species_alias':
    case 'species_unknown':
      return `speciesRaw=${record.speciesRaw}`
    case 'coordinate_invalid':
      return `latitudeRaw=${record.latitudeRaw}|longitudeRaw=${record.longitudeRaw}`
    case 'location_jump':
      return [
        `lat=${record.latitude}`,
        `lng=${record.longitude}`,
        `observedAt=${record.observedAt}`,
        `prevRing=${previous?.normalizedRingCode ?? ''}`,
        `prevLat=${previous?.latitude ?? ''}`,
        `prevLng=${previous?.longitude ?? ''}`,
        `prevObservedAt=${previous?.observedAt ?? ''}`,
      ].join('|')
    default:
      return ''
  }
}

export function validateRecords(records: BirdRecord[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const ringGroups = new Map<string, BirdRecord[]>()

  records.forEach((record) => {
    const key = record.normalizedRingCode
    const list = ringGroups.get(key) || []
    list.push(record)
    ringGroups.set(key, list)
  })

  records.forEach((record, index) => {
    const ring = normalizeRingCode(record.rawRingCode)
    const detectedAt = new Date().toISOString()
    if (!ring.valid) {
      issues.push({
        id: `issue-ring-${record.id}`,
        recordId: record.id,
        type: 'ring_invalid',
        severity: 'error',
        title: '环号格式无法归一化',
        description: `原始环号“${record.rawRingCode}”无法完整识别方案、年份和序列号。`,
        field: 'rawRingCode',
        currentValue: record.rawRingCode,
        suggestedValue: `${ring.normalizedPrefix || 'CN'}-${new Date(record.observedAt).getFullYear()}-${String((index + 1) % 99999).padStart(5, '0')}`,
        suggestion: '根据来源文件年份和原序列尾号补齐标准方案前缀。',
        basis: issueBasis('ring_invalid', record),
        status: 'open',
        detectedAt,
      })
    }

    if (ring.valid) {
      const sameRing = ringGroups.get(record.normalizedRingCode) || []
      if (sameRing.length > 1) {
        const otherYears = new Set(sameRing.map((item) => item.observedAt.slice(0, 4)))
        const sourceCount = new Set(sameRing.map((item) => item.source)).size
        if (otherYears.size > 1 || sourceCount > 1) {
          issues.push({
            id: `issue-duplicate-${record.id}`,
            recordId: record.id,
            type: 'ring_duplicate',
            severity: 'error',
            title: sourceCount > 1 ? '多来源环号重复' : '跨年份重复环号',
            description: `归一化环号 ${record.normalizedRingCode} 在 ${otherYears.size} 个年度、${sourceCount} 个来源中共出现 ${sameRing.length} 次。`,
            field: 'normalizedRingCode',
            currentValue: record.normalizedRingCode,
            suggestedValue: `${ring.normalizedPrefix}-${record.observedAt.slice(0, 4)}-${String((Number(ring.serial) + 710) % 99999).padStart(5, '0')}`,
            suggestion: '核对原环照片或捕获登记表；确认非重捕记录后更换序列号。',
            basis: issueBasis('ring_duplicate', record),
            status: 'open',
            detectedAt,
          })
        }
      }
    }

    if (record.scientificName === '待鉴定' || record.speciesCanonical !== record.speciesRaw) {
      const automatic = record.scientificName !== '待鉴定'
      const speciesType: IssueType = automatic ? 'species_alias' : 'species_unknown'
      issues.push({
        id: `issue-species-${record.id}`,
        recordId: record.id,
        type: speciesType,
        severity: automatic ? 'warning' : 'review',
        title: automatic ? '鸟种使用同义名或俗名' : '鸟种待分类',
        description: automatic
          ? `“${record.speciesRaw}”可归一为规范名称“${record.speciesCanonical}”。`
          : `“${record.speciesRaw}”未匹配到鸟种库中的可靠学名。`,
        field: 'speciesRaw',
        currentValue: record.speciesRaw,
        suggestedValue: automatic ? record.speciesCanonical : '',
        suggestion: automatic
          ? `采用规范中文名与学名 ${record.scientificName}。`
          : '请由鉴定人员补充物种或注明仅鉴定至属/科。',
        basis: issueBasis(speciesType, record),
        status: 'open',
        detectedAt,
      })
    }

    if (
      parseCoordinate(record.latitudeRaw, 'latitude') === null ||
      parseCoordinate(record.longitudeRaw, 'longitude') === null
    ) {
      issues.push({
        id: `issue-coordinate-${record.id}`,
        recordId: record.id,
        type: 'coordinate_invalid',
        severity: 'error',
        title: '坐标格式无效',
        description: `纬度“${record.latitudeRaw}”、经度“${record.longitudeRaw}”不能同时转换为有效坐标。`,
        field: 'latitudeRaw',
        currentValue: `${record.latitudeRaw} / ${record.longitudeRaw}`,
        suggestedValue: '',
        suggestion: '根据地点主表补齐十进制度数或标准度分秒格式。',
        basis: issueBasis('coordinate_invalid', record),
        status: 'open',
        detectedAt,
      })
    }

    const previous = records
      .slice(Math.max(0, index - 30), index)
      .filter((item) => item.normalizedRingCode === record.normalizedRingCode)
      .at(-1)
    if (previous) {
      const distance = getLocationDistance(record, previous)
      const days = Math.abs(
        (new Date(record.observedAt).getTime() - new Date(previous.observedAt).getTime()) /
          86400000,
      )
      if (distance !== null && distance > 500 && days < 45) {
        issues.push({
          id: `issue-jump-${record.id}`,
          recordId: record.id,
          type: 'location_jump',
          severity: 'warning',
          title: '同环号地点异常跳变',
          description: `与同环号上一条记录相距 ${Math.round(distance)} 公里，间隔仅 ${Math.max(1, Math.round(days))} 天。`,
          field: 'location',
          currentValue: record.location,
          suggestedValue: previous.location,
          suggestion: '核对观察日期、地点和环号；若为回收记录需补充运输或救助信息。',
          basis: issueBasis('location_jump', record, previous),
          status: 'open',
          detectedAt,
        })
      }
    }
  })

  return issues.sort((a, b) => {
    const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    return severity || a.recordId.localeCompare(b.recordId)
  })
}

/**
 * 按最新记录重新校验，并把人工处置结论接到新数据上：
 * - 判定依据（basis）未变的问题，保留已接受/已退回/已修正结论；
 * - 判定依据发生变化（如坐标被更正）的问题，先失效（回到待处理），再按新值重新确认；
 * - 重新校验后不再出现的问题：已修正的留档，待处理的视为已随更正闭合，已接受/退回的不再挂出（处置历史仍在）。
 */
export function revalidateRecords(
  records: BirdRecord[],
  prevIssues: ValidationIssue[],
): ValidationIssue[] {
  const fresh = validateRecords(records)
  const prevById = new Map(prevIssues.map((issue) => [issue.id, issue]))
  const freshIds = new Set(fresh.map((issue) => issue.id))
  const result: ValidationIssue[] = []

  for (const issue of fresh) {
    const prev = prevById.get(issue.id)
    if (prev && prev.status !== 'open' && prev.basis === issue.basis) {
      result.push({ ...issue, status: prev.status, returnReason: prev.returnReason })
    } else {
      result.push(issue)
    }
  }

  for (const prev of prevIssues) {
    if (freshIds.has(prev.id)) continue
    if (prev.status === 'corrected') {
      result.push(prev)
    } else if (prev.status === 'open') {
      result.push({ ...prev, status: 'corrected' as IssueStatus })
    }
  }

  return result.sort((a, b) => {
    const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    return severity || a.recordId.localeCompare(b.recordId)
  })
}

export function countBySeverity(issues: ValidationIssue[]) {
  return issues.reduce(
    (counts, issue) => {
      counts[issue.severity] += 1
      return counts
    },
    { error: 0, warning: 0, review: 0 },
  )
}

export function applyIssueSuggestion(record: BirdRecord, issue: ValidationIssue): BirdRecord {
  if (!issue.suggestedValue) return record
  if (issue.field === 'rawRingCode') {
    const ring = normalizeRingCode(issue.suggestedValue)
    return {
      ...record,
      rawRingCode: issue.suggestedValue,
      normalizedRingCode: ring.normalized,
      ringScheme: ring.scheme,
    }
  }
  if (issue.field === 'speciesRaw') {
    const species = record.scientificName
    return {
      ...record,
      speciesRaw: issue.suggestedValue,
      speciesCanonical: issue.suggestedValue,
      scientificName: species,
    }
  }
  if (issue.field === 'location') {
    return { ...record, location: issue.suggestedValue }
  }
  if (issue.field === 'normalizedRingCode') {
    const ring = normalizeRingCode(issue.suggestedValue)
    return {
      ...record,
      rawRingCode: issue.suggestedValue,
      normalizedRingCode: ring.normalized,
      ringScheme: ring.scheme,
    }
  }
  return record
}
