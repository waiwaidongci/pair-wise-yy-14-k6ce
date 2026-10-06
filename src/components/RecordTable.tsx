import { Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { BirdRecord } from '../types'

interface RecordTableProps {
  records: BirdRecord[]
  selectedRowKeys?: React.Key[]
  onSelectionChange?: (keys: React.Key[]) => void
  height?: number
  compact?: boolean
}

export function RecordTable({
  records,
  selectedRowKeys,
  onSelectionChange,
  height = 560,
  compact = false,
}: RecordTableProps) {
  const columns: ColumnsType<BirdRecord> = [
    {
      title: '记录编号',
      dataIndex: 'id',
      width: 120,
      fixed: 'left',
      render: (value: string, record) => (
        <Tooltip title={record.frozenVersion ? `已冻结于 ${record.frozenVersion}，不吸收后到更正` : '未冻结，可继续核对'}>
          <Typography.Text code>
            {value}
            {record.frozenVersion ? ' 🔒' : ''}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: '批次 / 版本',
      key: 'batch',
      width: 165,
      render: (_: unknown, record) => (
        <div className="batch-cell">
          <Tooltip title={`并入历史：${record.batchHistory.join(' → ')}`}>
            <Tag color={record.frozenVersion ? 'blue' : 'geekblue'} style={{ marginInlineEnd: 0 }}>
              {record.batchNo}
            </Tag>
          </Tooltip>
          <span className="muted-text">v{record.version}{record.frozenVersion ? ` · ${record.frozenVersion}` : ''}</span>
        </div>
      ),
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 190,
      ellipsis: true,
      render: (value: string, record) => (
        <Tooltip title={record.sourceFile}>
          <span>{value}</span>
        </Tooltip>
      ),
    },
    {
      title: '原始环号',
      dataIndex: 'rawRingCode',
      width: 145,
      render: (value: string, record) =>
        value === record.normalizedRingCode ? (
          value
        ) : (
          <Tag color="orange">{value}</Tag>
        ),
    },
    {
      title: '归一化环号',
      dataIndex: 'normalizedRingCode',
      width: 150,
      render: (value: string) => <strong className="ring-code">{value || '未识别'}</strong>,
    },
    {
      title: '环志方案',
      dataIndex: 'ringScheme',
      width: 150,
      ellipsis: true,
    },
    {
      title: '原始鸟种',
      dataIndex: 'speciesRaw',
      width: 152,
      ellipsis: true,
      render: (value: string, record) =>
        value === record.speciesCanonical ? value : <Tag color="gold">{value}</Tag>,
    },
    {
      title: '规范鸟种 / 学名',
      dataIndex: 'speciesCanonical',
      width: 210,
      render: (value: string, record) => (
        <span>
          <strong>{value}</strong>
          <em className="scientific-name">{record.scientificName}</em>
        </span>
      ),
    },
    { title: '观察时间', dataIndex: 'observedAt', width: 160 },
    { title: '地点', dataIndex: 'location', width: 140 },
    {
      title: '坐标',
      key: 'coordinate',
      width: 180,
      render: (_, record) =>
        record.latitude === null || record.longitude === null ? (
          <Tag color="red">格式异常</Tag>
        ) : (
          <span className="coordinate-cell">
            {record.latitude.toFixed(5)}, {record.longitude.toFixed(5)}
          </span>
        ),
    },
    { title: '环志员', dataIndex: 'recorder', width: 100 },
    ...(compact
      ? []
      : [
          { title: '年龄', dataIndex: 'ageCode', width: 90 },
          { title: '性别', dataIndex: 'sex', width: 70 },
          { title: '备注', dataIndex: 'remarks', width: 260, ellipsis: true },
        ]),
  ]

  return (
    <Table<BirdRecord>
      virtual
      size="small"
      bordered
      rowKey="id"
      columns={columns}
      dataSource={records}
      pagination={false}
      scroll={{ x: 2010, y: height }}
      rowSelection={
        onSelectionChange
          ? {
              selectedRowKeys,
              onChange: onSelectionChange,
              preserveSelectedRowKeys: true,
            }
          : undefined
      }
    />
  )
}
