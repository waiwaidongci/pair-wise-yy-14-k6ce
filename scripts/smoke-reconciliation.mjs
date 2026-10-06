// 临时端到端逻辑验证：批次并入 → 问题失效/重新确认 → 冻结 → 后到差异
import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  logLevel: 'error',
  configFile: '/workspace/vite.config.ts',
  optimizeDeps: { noDiscovery: true },
})
const { createMockRecords } = await server.ssrLoadModule('/src/data/mockRecords.ts')
const { validateRecords } = await server.ssrLoadModule('/src/utils/validation.ts')
const { ingestCorrectionBatch, buildTransferPackage, refreshPackageDifferenceCounters } = await server.ssrLoadModule('/src/utils/reconciliation.ts')
const { PENDING_INGEST_BATCHES } = await server.ssrLoadModule('/src/data/ingestBatches.ts')

let records = createMockRecords()
let issues = validateRecords(records)
let differences = []
let packages = []

const assert = (cond, msg) => {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1 }
  else console.log('✅', msg)
}

assert(records.every((r) => r.batchNo === 'B2026-S00-INIT' && r.version === 1), '初始批次号回填、版本 v1')

// 取 S01 命中的两个记录及原始跳变问题
const jump510 = issues.find((i) => i.recordId === 'REC-000510' && i.type === 'location_jump')
assert(Boolean(jump510) && jump510.status === 'open', 'REC-000510 初始存在待处理跳变问题')
const jump1019 = issues.find((i) => i.recordId === 'REC-001019' && i.type === 'location_jump')
assert(Boolean(jump1019), 'REC-001019 初始存在跳变问题')

// 先人工接受 REC-000510 的跳变结论，验证后到更正不会静默冲掉它
issues = issues.map((i) => (i.id === jump510.id ? { ...i, status: 'accepted' } : i))

// 并入 S01（冻结前）
const s01 = PENDING_INGEST_BATCHES.find((b) => b.batchNo === 'B2026-S01')
let res = ingestCorrectionBatch(records, issues, differences, s01)
records = res.records; issues = res.issues; differences = res.differences

const inv510 = issues.find((i) => i.id === jump510.id)
assert(inv510.status === 'invalidated' && inv510.previousStatus === 'accepted', '坐标改动后旧跳变失效，且保留“已接受”结论')
const successor510 = issues.find((i) => i.reopenedFrom === jump510.id)
assert(!successor510, 'REC-000510 新值下跳变不成立，不生成新问题（复核关闭）')
assert(inv510.invalidatedReason.includes('不再成立'), '失效原因注明复核不再成立')

const inv1019 = issues.find((i) => i.id === jump1019.id)
assert(inv1019.status === 'invalidated', 'REC-001019 旧跳变失效')
const succ1019 = issues.find((i) => i.reopenedFrom === jump1019.id)
assert(Boolean(succ1019) && succ1019.status === 'open' && succ1019.type === 'location_jump', 'REC-001019 新值下跳变仍成立，生成新问题接续旧问题')
assert(inv1019.supersededBy === succ1019.id, '旧问题指向接续的新问题')
assert(records.find((r) => r.id === 'REC-000510').batchNo === 'B2026-S01' && records.find((r) => r.id === 'REC-000510').version === 2, '吸收更正后批次号/版本更新，batchHistory 追加')
assert(records.find((r) => r.id === 'REC-000510').batchHistory.join() === 'B2026-S00-INIT,B2026-S01', 'batchHistory 含初始批次与补交批次')

// 并入 S02
const s02 = PENDING_INGEST_BATCHES.find((b) => b.batchNo === 'B2026-S02')
res = ingestCorrectionBatch(records, issues, differences, s02)
records = res.records; issues = res.issues; differences = res.differences
const species1 = issues.find((i) => i.recordId === 'REC-000001' && (i.type === 'species_alias' || i.type === 'species_unknown'))
assert(species1.status === 'invalidated' && species1.invalidatedReason.includes('不再成立'), 'REC-000001 鸟种改对后俗名问题失效并复核关闭')
const coord1250 = issues.find((i) => i.recordId === 'REC-001250' && i.type === 'coordinate_invalid')
assert(coord1250.status === 'invalidated', 'REC-001250 补全经度后坐标问题失效')

// 冻结移交包
const built = buildTransferPackage(records, issues, 'PKG-2026.1-v1', '2026 春季移交批次', '冒烟测试')
records = built.records
packages = refreshPackageDifferenceCounters([...packages, built.pkg], differences)
assert(records.every((r) => r.frozenVersion === 'PKG-2026.1-v1'), '全部记录写入冻结版本')
assert(built.pkg.recordCount === records.length, `移交包含全部记录 ${built.pkg.recordCount}`)

// 并入冻结后到达的 S03：不吸收，只出差异
const before = JSON.stringify(records.map((r) => ({ id: r.id, loc: r.location, remarks: r.remarks })))
const s03 = PENDING_INGEST_BATCHES.find((b) => b.batchNo === 'B2026-S03')
res = ingestCorrectionBatch(records, issues, differences, s03)
records = res.records; issues = res.issues; differences = res.differences
packages = refreshPackageDifferenceCounters(packages, differences)
const after = JSON.stringify(records.map((r) => ({ id: r.id, loc: r.location, remarks: r.remarks })))
assert(before === after, '冻结记录未被后到更正覆盖')
assert(differences.length === 2 && differences.every((d) => d.status === 'pending'), `生成 2 条待核对差异（实际 ${differences.length}）`)
assert(differences.every((d) => d.packageVersion === 'PKG-2026.1-v1' && d.batchNo === 'B2026-S03'), '差异挂接冻结版本与补交批次')
assert(packages[0].pendingDifferenceCount === 2, '冻结包差异条数回写为 2')
const diff2 = differences.find((d) => d.recordId === 'REC-000002')
const frozenLoc = records.find((r) => r.id === 'REC-000002').location
assert(diff2.frozenValue === frozenLoc && diff2.incomingValue.includes('大湖池') && diff2.frozenValue !== diff2.incomingValue, '差异同时保留冻结原值与后到更正值')

// 冻结后再并入已并入批次不应重复
assert(res.frozenRecordIds.length === 2, 'S03 两条更正都识别为冻结记录')

// 导出：批次号/冻结版本/差异条数都在
const { exportRecordsCsv, exportTransferJson, exportValidationCsv, exportDifferencesCsv } = await server.ssrLoadModule('/src/utils/exporters.ts')
const captured = []
let latest = ''
const { Blob: NodeBlob } = await import('node:buffer')
globalThis.Blob = class {
  constructor(parts) { latest = String(parts[0]); captured.push(latest) }
}
globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }
globalThis.document = {
  createElement: () => ({
    click() { /* latest already captured at Blob construction */ },
  }),
}
exportRecordsCsv(records, issues, differences)
exportValidationCsv(issues, records)
exportDifferencesCsv(differences, packages)
assert(captured.length === 3, '三个 CSV 导出均生成文件')
const [recordsCsv, issuesCsv, diffsCsv] = captured
assert(recordsCsv.includes('批次号') && recordsCsv.includes('冻结版本') && recordsCsv.includes('待核对差异条数'), '记录 CSV 含批次号/冻结版本/差异条数列')
assert(recordsCsv.includes('PKG-2026.1-v1') && recordsCsv.includes('B2026-S00-INIT'), '记录 CSV 数据行带冻结版本与初始批次号')
assert(issuesCsv.includes('已失效待重认'), '问题 CSV 含失效状态')
assert(diffsCsv.includes('B2026-S03') && diffsCsv.includes('大湖池'), '差异 CSV 含后到批次与更正值')
// JSON 导出
exportTransferJson(records, issues, [], PENDING_INGEST_BATCHES, packages, differences)
const json = JSON.parse(latest)
assert(json.batchReconciliation.initialBatchNo === 'B2026-S00-INIT', 'JSON 带批次核对信息与初始批次号')
assert(json.batchReconciliation.pendingDifferenceCount === 2, 'JSON 汇总带待核对差异条数')
assert(json.records[0].pendingDifferenceCount !== undefined && json.records[0].frozenVersion === 'PKG-2026.1-v1', 'JSON 每条记录带冻结版本与差异条数')
void NodeBlob

console.log('\nissue status counts:', issues.reduce((m, i) => (m[i.status] = (m[i.status] || 0) + 1, m), {}))
await server.close()
