import { useValidationStore } from '../src/stores/validationStore'
import { INITIAL_BATCH_ID } from '../src/utils/batches'

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exitCode = 1
  } else {
    console.log('ok:', msg)
  }
}

const store = useValidationStore

// 0. initial state: batch backfill
const s0 = store.getState()
assert(s0.records.length === 4200, `initial records count = 4200 (got ${s0.records.length})`)
assert(
  s0.records.every((r) => r.batchId === INITIAL_BATCH_ID),
  'all records backfilled to initial batch',
)
assert(s0.records.every((r) => r.frozenVersion === null), 'no records frozen initially')
assert(s0.batches.length === 1 && s0.batches[0].id === INITIAL_BATCH_ID, 'initial batch present')
assert(s0.packages.length === 0, 'no packages initially')

// 1. freeze package v1
store.getState().freezePackage()
const s1 = store.getState()
assert(s1.packages.length === 1, 'one package after freeze')
assert(s1.packages[0].version === 1, 'frozen version = v1')
assert(
  s1.records.every((r) => r.frozenVersion === 1),
  'all records marked frozen at v1',
)
assert(s1.packages[0].recordCount === 4200, 'package snapshot has 4200 records')
assert(s1.operations[0].action === 'freeze', 'freeze operation logged')

// 2. accept a location_jump issue before supplement (to test invalidation)
const jumpIssue = s1.issues.find((i) => i.type === 'location_jump' && i.status === 'open')
assert(!!jumpIssue, 'there is an open location_jump issue')
if (jumpIssue) {
  store.getState().acceptIssues([jumpIssue.id])
  const afterAccept = store.getState().issues.find((i) => i.id === jumpIssue.id)
  assert(afterAccept?.status === 'accepted', 'jump issue accepted (human conclusion)')
}

// 3. apply supplementary batch -> frozen records must NOT absorb; diffs listed
const result = store.getState().applySupplementaryBatch()
console.log('   supplement result:', result)
const s2 = store.getState()
assert(result.diffed > 0, `supplementary batch produced diffs (got ${result.diffed})`)
assert(result.applied === 0, 'frozen records absorbed 0 corrections')
assert(s2.packages[0].diffs.length === result.diffed, 'diffs registered in latest package')
assert(
  s2.records.every((r) => r.frozenVersion === 1),
  'frozen records still at v1 after supplement',
)
assert(
  s2.batches.length === 2 && s2.batches[1].kind === 'supplement',
  'supplementary batch added',
)
assert(s2.operations[0].action === 'supplement', 'supplement operation logged')

// 4. diff fields are semantic (location/latitude/longitude) and frozen != incoming
const sampleDiff = s2.packages[0].diffs[0]
assert(!!sampleDiff, 'a diff exists')
if (sampleDiff) {
  console.log('   sample diff:', sampleDiff.recordId, sampleDiff.field, `"${sampleDiff.frozenValue}" -> "${sampleDiff.incomingValue}"`)
  assert(
    ['location', 'latitude', 'longitude'].includes(sampleDiff.field),
    'diff is a semantic field (location/latitude/longitude)',
  )
  assert(
    sampleDiff.frozenValue !== sampleDiff.incomingValue,
    'diff frozen value differs from incoming correction',
  )
  assert(sampleDiff.status === 'pending', 'diff starts pending')
}

// 5. resolve a diff as accepted -> then freeze v2 absorbs it
const diffToAccept = s2.packages[0].diffs.find((d) => d.status === 'pending')
if (diffToAccept) {
  store.getState().resolveDiff(s2.packages[0].id, diffToAccept.id, 'accepted')
  const s3 = store.getState()
  const resolved = s3.packages[0].diffs.find((d) => d.id === diffToAccept.id)
  assert(resolved?.status === 'accepted', 'diff marked accepted')
  assert(s3.operations[0].action === 'diff_resolve', 'diff_resolve operation logged')

  // freeze v2 -> accepted diff absorbed
  store.getState().freezePackage()
  const s4 = store.getState()
  assert(s4.packages.length === 2, 'second package created')
  assert(s4.packages[0].version === 2, 'new package is v2')
  assert(
    s4.records.every((r) => r.frozenVersion === 2),
    'all records now at v2',
  )
  const absorbed = s4.records.find((r) => r.id === diffToAccept.recordId)
  const absorbedVal = absorbed
    ? (absorbed as unknown as Record<string, unknown>)[diffToAccept.field]
    : null
  const incomingNum = Number(diffToAccept.incomingValue)
  assert(
    absorbedVal !== null && Math.abs(Number(absorbedVal) - incomingNum) < 0.0001,
    `v2 absorbed accepted diff for ${diffToAccept.field} (got ${absorbedVal}, want ${incomingNum})`,
  )
  // v2 carries pending diffs forward, re-based
  assert(
    s4.packages[0].diffs.every((d) => d.status === 'pending'),
    'v2 carries pending diffs forward',
  )
}

// 6. non-frozen absorption: reset, no freeze -> supplement applies directly
store.getState().reset()
const s5n = store.getState()
assert(s5n.packages.length === 0, 'reset clears packages')
const result2 = store.getState().applySupplementaryBatch()
console.log('   non-frozen supplement result:', result2)
assert(result2.applied > 0 && result2.diffed === 0, 'unfrozen records absorb corrections directly')
const s6n = store.getState()
assert(
  s6n.records.some((r) => r.batchId === result2.batchId),
  'absorbed records stamped with supplementary batch id',
)
assert(
  s6n.records.every((r) => r.frozenVersion === null),
  'unfrozen records remain unfrozen after absorption',
)
const stillInvalid = s6n.records.filter((r) => r.latitude === null || r.longitude === null)
assert(stillInvalid.length === 0, 'all coordinate_invalid records corrected after absorption')

// 7. revalidate invalidation: accept a jump, change coordinates, reopen
store.getState().reset()
const s5 = store.getState()
assert(s5.packages.length === 0, 'fresh state for invalidation test')
const jump = s5.issues.find((i) => i.type === 'location_jump' && i.status === 'open')
if (jump) {
  store.getState().acceptIssues([jump.id])
  const accepted = store.getState().issues.find((i) => i.id === jump.id)
  assert(accepted?.status === 'accepted', 'precondition: jump accepted')
  const rec = s5.records.find((r) => r.id === jump.recordId)
  if (rec) {
    store.getState().updateRecord(rec.id, { latitudeRaw: '31.50000', longitudeRaw: '121.90000' }, 'coordinate correction test')
    const after = store.getState().issues.find((i) => i.id === jump.id)
    const invalidated = !after || after.status === 'open'
    assert(invalidated, 'jump issue invalidated after coordinate change (reopened or resolved)')
    const op = store.getState().operations[0]
    assert(op.action === 'manual_edit', 'manual_edit operation logged')
  }
}

// 8. revalidate preserves accepted conclusion when basis unchanged
store.getState().reset()
const s6 = store.getState()
const species = s6.issues.find((i) => i.type === 'species_alias' && i.status === 'open')
if (species) {
  store.getState().acceptIssues([species.id])
  const rec = s6.records.find((r) => r.id === species.recordId)
  if (rec) {
    store.getState().updateRecord(rec.id, { remarks: 'unrelated edit' }, 'remark only')
    const after = store.getState().issues.find((i) => i.id === species.id)
    assert(after?.status === 'accepted', 'accepted conclusion preserved when basis unchanged')
  }
}

// 9. validateRecords produces basis on every issue
const s7 = store.getState()
assert(
  s7.issues.every((i) => typeof i.basis === 'string' && i.basis.length > 0),
  'every issue has a basis fingerprint',
)

console.log('\ndone.')
