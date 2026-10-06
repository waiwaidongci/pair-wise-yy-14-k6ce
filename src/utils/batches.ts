import { getLocationDistance, LOCATIONS } from '../data/mockRecords'
import type { Batch, BirdRecord } from '../types'

export const INITIAL_BATCH_ID = 'PC-2026-INITIAL'

export function createInitialBatch(): Batch {
  return {
    id: INITIAL_BATCH_ID,
    label: '2026 春季环志数据 · 初始批次',
    kind: 'initial',
    source: '华东区域鸟类环志中心汇总',
    receivedAt: '2026-03-01T00:00:00.000Z',
    note: '各监测站首次报送并合并的环志记录；批次号缺失的记录统一回填为初始批次。',
  }
}

export function nextSupplementaryBatch(batches: Batch[]): Batch {
  const seq = String(batches.length).padStart(3, '0')
  return {
    id: `PC-2026-SUP-${seq}`,
    label: `2026 春季环志数据 · 补交更正批次 ${seq}`,
    kind: 'supplement',
    source: '各监测站补交与更正',
    receivedAt: new Date().toISOString(),
    note: '监测站分两三次补交的更正数据；已冻结记录不再吸收后到更正，仅列待核对差异。',
  }
}

export interface RecordCorrection {
  recordId: string
  patch: Partial<BirdRecord>
}

/**
 * 模拟监测站补交的更正值：
 * - 坐标无效的记录，按申报地点主表补齐经纬度；
 * - 同环号地点跳变的记录，把地点与坐标对齐到上一条同环号记录，消除跳变。
 */
export function computeSupplementaryCorrections(records: BirdRecord[]): RecordCorrection[] {
  const patches = new Map<string, Partial<BirdRecord>>()
  const merge = (recordId: string, patch: Partial<BirdRecord>) => {
    patches.set(recordId, { ...(patches.get(recordId) || {}), ...patch })
  }

  records.forEach((record) => {
    if (record.latitude === null || record.longitude === null) {
      const loc = LOCATIONS.find((item) => item.name === record.location)
      if (loc) {
        merge(record.id, {
          latitudeRaw: loc.latitude.toFixed(5),
          longitudeRaw: loc.longitude.toFixed(5),
          latitude: loc.latitude,
          longitude: loc.longitude,
        })
      }
    }
  })

  records.forEach((record, index) => {
    let previous: BirdRecord | undefined
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (records[cursor].normalizedRingCode === record.normalizedRingCode) {
        previous = records[cursor]
        break
      }
    }
    if (!previous) return
    const distance = getLocationDistance(record, previous)
    const days = Math.abs(
      (new Date(record.observedAt).getTime() - new Date(previous.observedAt).getTime()) / 86400000,
    )
    if (distance !== null && distance > 500 && days < 45) {
      const prevLoc = LOCATIONS.find((item) => item.name === previous!.location)
      if (prevLoc) {
        merge(record.id, {
          location: previous!.location,
          latitudeRaw: prevLoc.latitude.toFixed(5),
          longitudeRaw: prevLoc.longitude.toFixed(5),
          latitude: prevLoc.latitude,
          longitude: prevLoc.longitude,
        })
      }
    }
  })

  return [...patches.entries()].map(([recordId, patch]) => ({ recordId, patch }))
}

const FIELD_LABELS: Record<string, string> = {
  location: '地点',
  latitude: '纬度',
  longitude: '经度',
  latitudeRaw: '纬度原始值',
  longitudeRaw: '经度原始值',
  speciesRaw: '原始鸟种',
  observedAt: '观察时间',
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] || field
}

export function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '空'
  if (typeof value === 'number') {
    return field === 'latitude' || field === 'longitude' ? value.toFixed(5) : String(value)
  }
  return String(value)
}
