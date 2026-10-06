import type { IngestBatch } from '../types'

/**
 * 各监测站分两、三次补交的更正批次。
 * B2026-S01 / B2026-S02 在移交冻结前到达，会并入工作集并触发“失效—重新确认”；
 * B2026-S03 模拟冻结之后才到，不覆盖冻结记录，只形成待核对差异。
 */
export const PENDING_INGEST_BATCHES: IngestBatch[] = [
  {
    batchNo: 'B2026-S01',
    source: '崇明东滩监测站',
    sourceFile: '2026_补交_坐标勘误_1批.xlsx',
    receivedAt: '2026-09-18T09:20:00.000Z',
    note: '第一次补交：核对 GPS 备份后更正两处坐标——REC-000510 跳变不成立，REC-001019 新值下跳变仍成立、需重新确认。',
    status: 'pending',
    corrections: [
      {
        recordId: 'REC-000510',
        reason: 'GPS 设备时区与格式转换错误，实际地点与上一条同环号记录一致（崇明东滩），异常跳变不成立。',
        fields: {
          latitudeRaw: '31.53012',
          longitudeRaw: '121.94988',
        },
      },
      {
        recordId: 'REC-001019',
        reason: '坐标备份导出错误，正确坐标为湛江红树林位点；与上一条位点仍相距超 500 公里，跳变需重新确认。',
        fields: {
          latitudeRaw: '21.18034',
          longitudeRaw: '110.42971',
        },
      },
    ],
  },
  {
    batchNo: 'B2026-S02',
    source: '云南会泽夜栖调查',
    sourceFile: '2026_补交_鸟种坐标_2批.xlsx',
    receivedAt: '2026-09-25T14:05:00.000Z',
    note: '第二次补交：鉴定组订正鸟种俗名，并按纸质登记表补全一条缺失经度。',
    status: 'pending',
    corrections: [
      {
        recordId: 'REC-000001',
        reason: '原始表填写俗名“大雁”，鉴定组确认为鸿雁。',
        fields: {
          speciesRaw: '鸿雁',
        },
      },
      {
        recordId: 'REC-001250',
        reason: '原经度列为“--”，已按纸质登记表补录度分秒经度。',
        fields: {
          longitudeRaw: '114°03′36″E',
        },
      },
    ],
  },
  {
    batchNo: 'B2026-S03',
    source: '鄱阳湖巡护队',
    sourceFile: '2026_补交_冻结后更正_3批.xlsx',
    receivedAt: '2026-10-04T08:40:00.000Z',
    note: '第三次补交：移交包冻结之后才送达，按规程不覆盖已冻结记录，仅形成待核对差异。',
    status: 'pending',
    corrections: [
      {
        recordId: 'REC-000002',
        reason: '移交后监测站复核发现夜栖地点名称需补充保护区分区。',
        fields: {
          location: '鄱阳湖吴城（大湖池分区）',
        },
      },
      {
        recordId: 'REC-000003',
        reason: '回收登记表补注：该个体佩戴卫星追踪器，附追踪数据编号。',
        fields: {
          remarks: '补充卫星追踪器编号 PT-2026-0447，原拆分说明保留。',
        },
      },
    ],
  },
]
