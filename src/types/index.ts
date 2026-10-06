export type IssueSeverity = 'error' | 'warning' | 'review'
export type IssueStatus = 'open' | 'accepted' | 'returned' | 'corrected' | 'invalidated'
export type IssueType =
  | 'ring_invalid'
  | 'ring_duplicate'
  | 'species_alias'
  | 'species_unknown'
  | 'coordinate_invalid'
  | 'location_jump'

export interface SpeciesRule {
  canonical: string
  scientificName: string
  aliases: string[]
}

export interface RingScheme {
  prefix: string
  normalizedPrefix: string
  organization: string
  pattern: string
}

export interface BirdRecord {
  id: string
  source: string
  sourceFile: string
  /** 该记录当前值所在批次：初始批次或最后一次并入的补交批次 */
  batchNo: string
  /** 记录内容版本，并入一次补交更正即递增 */
  version: number
  /** 冻结该记录的最近移交包版本，未冻结为空 */
  frozenVersion: string
  /** 被并入工作集的批次号序列（含初始批次） */
  batchHistory: string[]
  rawRingCode: string
  normalizedRingCode: string
  ringScheme: string
  speciesRaw: string
  speciesCanonical: string
  scientificName: string
  observedAt: string
  location: string
  latitudeRaw: string
  longitudeRaw: string
  latitude: number | null
  longitude: number | null
  recorder: string
  ageCode: string
  sex: string
  remarks: string
}

export interface ValidationIssue {
  id: string
  recordId: string
  type: IssueType
  severity: IssueSeverity
  title: string
  description: string
  field: keyof BirdRecord
  currentValue: string
  suggestedValue: string
  suggestion: string
  status: IssueStatus
  returnReason?: string
  detectedAt: string
  /** 问题首次发现的批次 */
  batchNo: string
  /** 依赖基础发生变化被失效时，记录原人工结论 */
  previousStatus?: Exclude<IssueStatus, 'open' | 'invalidated'>
  invalidatedAt?: string
  invalidatedReason?: string
  /** 被新问题接续时，新问题 id */
  supersededBy?: string
  /** 接续旧问题的 id */
  reopenedFrom?: string
  /** 跳变问题依赖的前一条同环号记录 */
  basisRecordId?: string
}

export interface OperationSnapshot {
  records: BirdRecord[]
  issues: ValidationIssue[]
  batches: IngestBatch[]
  packages: TransferPackage[]
  differences: PendingDifference[]
}

export type OperationAction =
  | 'batch_fix'
  | 'accept'
  | 'return'
  | 'manual_edit'
  | 'reset'
  | 'ingest'
  | 'freeze'
  | 'diff_review'

export interface OperationLog {
  id: string
  action: OperationAction
  title: string
  detail: string
  count: number
  timestamp: string
  rolledBack: boolean
  /** 冻结移交包之后的操作不允许回滚；非空表示受该冻结版本保护 */
  frozenSince?: string
  snapshot: OperationSnapshot
}

export interface IssueRule {
  type: IssueType
  severity: IssueSeverity
  label: string
  description: string
  correctionMode: 'automatic' | 'manual'
}

/** 监测站补交/更正批次（移交前的来源批次） */
export interface IngestBatch {
  batchNo: string
  source: string
  sourceFile: string
  receivedAt: string
  note: string
  status: 'pending' | 'ingested'
  /** 同一环志记录的更正条目 */
  corrections: IngestCorrection[]
  ingestedAt?: string
}

export interface IngestCorrection {
  recordId: string
  fields: Partial<Pick<BirdRecord, 'rawRingCode' | 'speciesRaw' | 'location' | 'latitudeRaw' | 'longitudeRaw' | 'remarks'>>
  reason: string
}

/** 冻结进移交包的记录与冻结时问题、处置结论 */
export interface FrozenRecord extends BirdRecord {}

/** 冻结移交包：包内记录不再吸收后到更正 */
export interface TransferPackage {
  version: string
  name: string
  frozenAt: string
  note: string
  recordCount: number
  issueCount: number
  records: FrozenRecord[]
  issues: ValidationIssue[]
  /** 冻结后到达、与包内记录存在差异的补交批次号 */
  pendingDifferenceCount: number
  pendingDifferenceBatches: string[]
}

export type DifferenceStatus = 'pending' | 'accepted' | 'rejected'

/** 冻结包与后到更正之间的待核对差异（只列出，不覆盖冻结值） */
export interface PendingDifference {
  id: string
  packageVersion: string
  batchNo: string
  recordId: string
  field: keyof BirdRecord
  frozenValue: string
  incomingValue: string
  reason: string
  receivedAt: string
  status: DifferenceStatus
  reviewedAt?: string
  reviewNote?: string
}
