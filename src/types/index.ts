export type IssueSeverity = 'error' | 'warning' | 'review'
export type IssueStatus = 'open' | 'accepted' | 'returned' | 'corrected'
export type IssueType =
  | 'ring_invalid'
  | 'ring_duplicate'
  | 'species_alias'
  | 'species_unknown'
  | 'coordinate_invalid'
  | 'location_jump'

export type BatchKind = 'initial' | 'supplement' | 'correction'

export interface Batch {
  id: string
  label: string
  kind: BatchKind
  source: string
  receivedAt: string
  note: string
}

export type DiffStatus = 'pending' | 'accepted' | 'rejected'

export interface RecordDiff {
  id: string
  recordId: string
  field: string
  fieldLabel: string
  frozenValue: string
  incomingValue: string
  status: DiffStatus
  detectedAt: string
}

export interface HandoverPackage {
  id: string
  version: number
  batchId: string
  batchLabel: string
  frozenAt: string
  recordCount: number
  records: BirdRecord[]
  issues: ValidationIssue[]
  diffs: RecordDiff[]
  note: string
}

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
  batchId: string
  frozenVersion: number | null
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
  basis: string
  detectedAt: string
}

export interface OperationSnapshot {
  records: BirdRecord[]
  issues: ValidationIssue[]
  packages?: HandoverPackage[]
  batches?: Batch[]
}

export interface OperationLog {
  id: string
  action: 'batch_fix' | 'accept' | 'return' | 'manual_edit' | 'reset' | 'freeze' | 'supplement' | 'diff_resolve'
  title: string
  detail: string
  count: number
  timestamp: string
  rolledBack: boolean
  snapshot: OperationSnapshot
}

export interface IssueRule {
  type: IssueType
  severity: IssueSeverity
  label: string
  description: string
  correctionMode: 'automatic' | 'manual'
}
