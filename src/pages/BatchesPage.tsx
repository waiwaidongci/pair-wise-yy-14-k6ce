import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DownloadOutlined,
  InboxOutlined,
  LockOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import {
  App as AntdApp,
  Alert,
  Badge,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo, useState } from 'react'
import { useValidationStore } from '../stores/validationStore'
import type { IngestBatch, PendingDifference, TransferPackage } from '../types'
import { exportDifferencesCsv } from '../utils/exporters'

export function BatchesPage() {
  const { message } = AntdApp.useApp()
  const records = useValidationStore((state) => state.records)
  const batches = useValidationStore((state) => state.batches)
  const packages = useValidationStore((state) => state.packages)
  const differences = useValidationStore((state) => state.differences)
  const ingestBatch = useValidationStore((state) => state.ingestBatch)
  const freezePackage = useValidationStore((state) => state.freezePackage)
  const reviewDifference = useValidationStore((state) => state.reviewDifference)

  const [freezeOpen, setFreezeOpen] = useState(false)
  const [freezeName, setFreezeName] = useState('2026 春季移交批次')
  const [freezeNote, setFreezeNote] = useState('')
  const [reviewTarget, setReviewTarget] = useState<PendingDifference | null>(null)
  const [reviewStatus, setReviewStatus] = useState<'accepted' | 'rejected'>('accepted')
  const [reviewNote, setReviewNote] = useState('')

  const frozenCount = records.filter((record) => record.frozenVersion).length
  const unfrozenCount = records.length - frozenCount
  const pendingDiffCount = differences.filter((diff) => diff.status === 'pending').length

  const recordById = useMemo(() => new Map(records.map((record) => [record.id, record])), [records])

  const runIngest = (batch: IngestBatch) => {
    const result = ingestBatch(batch.batchNo)
    if (result.frozen) {
      void message.warning(
        `批次 ${batch.batchNo}：${result.ingested} 条已并入，${result.frozen} 条已冻结记录未吸收更正，生成 ${result.differences} 条待核对差异`,
      )
    } else {
      void message.success(`批次 ${batch.batchNo} 已并入：更正 ${result.ingested} 条，相关问题已失效并重新确认`)
    }
  }

  const runFreeze = () => {
    const version = freezePackage(freezeName.trim() || '未命名移交包', freezeNote.trim())
    setFreezeOpen(false)
    setFreezeNote('')
    if (version) void message.success(`已冻结移交包 ${version}，共 ${unfrozenCount.toLocaleString()} 条记录`)
  }

  const openReview = (diff: PendingDifference, status: 'accepted' | 'rejected') => {
    setReviewTarget(diff)
    setReviewStatus(status)
    setReviewNote('')
  }

  const submitReview = () => {
    if (reviewTarget) {
      reviewDifference(reviewTarget.id, reviewStatus, reviewNote)
      void message.success(reviewStatus === 'accepted' ? '差异已标记为采纳（冻结值不变）' : '差异已驳回')
    }
    setReviewTarget(null)
  }

  const batchColumns: ColumnsType<IngestBatch> = [
    {
      title: '批次号',
      dataIndex: 'batchNo',
      width: 130,
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    { title: '监测站', dataIndex: 'source', width: 170 },
    { title: '来源文件', dataIndex: 'sourceFile', width: 250, ellipsis: true },
    {
      title: '到达时间',
      dataIndex: 'receivedAt',
      width: 170,
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '更正记录',
      dataIndex: 'corrections',
      width: 200,
      render: (_: unknown, batch) => (
        <Space wrap size={4}>
          {batch.corrections.map((correction) => {
            const record = recordById.get(correction.recordId)
            const isFrozen = Boolean(record?.frozenVersion)
            return (
              <Tag
                key={correction.recordId}
                icon={isFrozen ? <LockOutlined /> : undefined}
                color={isFrozen ? 'default' : 'geekblue'}
              >
                {correction.recordId}
                {isFrozen ? ` · ${record?.frozenVersion}` : ''}
              </Tag>
            )
          })}
        </Space>
      ),
    },
    { title: '批次说明', dataIndex: 'note', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: IngestBatch['status']) =>
        value === 'ingested' ? <Badge status="success" text="已并入" /> : <Badge status="warning" text="待并入" />,
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: unknown, batch) =>
        batch.status === 'pending' ? (
          <Popconfirm
            title={`并入批次 ${batch.batchNo}？`}
            description="未冻结记录吸收更正并重新校验；已冻结记录只生成待核对差异。"
            okText="并入"
            cancelText="取消"
            onConfirm={() => runIngest(batch)}
          >
            <Button type="primary" size="small" icon={<CloudUploadOutlined />}>
              并入批次
            </Button>
          </Popconfirm>
        ) : (
          <Tag color="green" icon={<CheckCircleOutlined />}>
            {new Date(batch.ingestedAt || '').toLocaleDateString('zh-CN')}
          </Tag>
        ),
    },
  ]

  const packageColumns: ColumnsType<TransferPackage> = [
    {
      title: '冻结版本',
      dataIndex: 'version',
      width: 150,
      render: (value: string) => <Typography.Text code strong>{value}</Typography.Text>,
    },
    { title: '移交包名称', dataIndex: 'name', width: 200 },
    {
      title: '冻结时间',
      dataIndex: 'frozenAt',
      width: 170,
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '记录 / 问题',
      key: 'counts',
      width: 140,
      render: (_: unknown, pkg) => (
        <Space size={4}>
          <Tag color="blue">{pkg.recordCount.toLocaleString()} 条记录</Tag>
          <Tag>{pkg.issueCount} 条问题</Tag>
        </Space>
      ),
    },
    {
      title: '后到待核对差异',
      key: 'diffs',
      width: 220,
      render: (_: unknown, pkg) =>
        pkg.pendingDifferenceCount ? (
          <Space size={4}>
            <Tag icon={<WarningOutlined />} color="volcano">
              {pkg.pendingDifferenceCount} 条待核对
            </Tag>
            <span className="filter-count">{pkg.pendingDifferenceBatches.join('、')}</span>
          </Space>
        ) : (
          <Tag icon={<CheckCircleOutlined />} color="green">
            暂无后到差异
          </Tag>
        ),
    },
    { title: '备注', dataIndex: 'note', ellipsis: true },
  ]

  const diffStatusMeta = {
    pending: { label: '待核对', color: 'volcano' },
    accepted: { label: '已采纳', color: 'green' },
    rejected: { label: '已驳回', color: 'default' },
  }

  const diffColumns: ColumnsType<PendingDifference> = [
    {
      title: '冻结版本',
      dataIndex: 'packageVersion',
      width: 150,
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    { title: '记录编号', dataIndex: 'recordId', width: 130 },
    { title: '补交批次', dataIndex: 'batchNo', width: 130 },
    { title: '字段', dataIndex: 'field', width: 110, render: (value: keyof typeof recordById) => String(value) },
    {
      title: '冻结值',
      dataIndex: 'frozenValue',
      width: 220,
      ellipsis: true,
      render: (value: string) => <Typography.Text type="secondary">{value || '空'}</Typography.Text>,
    },
    {
      title: '后到更正值',
      dataIndex: 'incomingValue',
      width: 260,
      ellipsis: true,
      render: (value: string) => <strong>{value || '空'}</strong>,
    },
    { title: '监测站说明', dataIndex: 'reason', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: PendingDifference['status']) => (
        <Tag color={diffStatusMeta[value].color}>{diffStatusMeta[value].label}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 170,
      render: (_: unknown, diff) =>
        diff.status === 'pending' ? (
          <Space size={4}>
            <Button size="small" type="link" onClick={() => openReview(diff, 'accepted')}>
              采纳
            </Button>
            <Button size="small" type="link" danger onClick={() => openReview(diff, 'rejected')}>
              驳回
            </Button>
          </Space>
        ) : (
          <span className="filter-count">{diff.reviewNote || '已核对'}</span>
        ),
    },
  ]

  const pendingDiffs = differences.filter((diff) => diff.status === 'pending')

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>补交批次核对与移交冻结</Typography.Title>
          <Typography.Paragraph type="secondary">
            监测站分多次补交同一批环志记录：未冻结记录吸收更正，坐标类问题先失效再按新值重新确认；
            冻结进移交包的记录不再被后到更正冲掉，只列出待核对差异。
          </Typography.Paragraph>
        </div>
        <Space>
          <Button
            icon={<DownloadOutlined />}
            disabled={!differences.length}
            onClick={() => {
              exportDifferencesCsv(differences, packages)
              void message.success(`已导出差异清单 ${differences.length} 条`)
            }}
          >
            导出差异 CSV
          </Button>
          <Button
            type="primary"
            icon={<LockOutlined />}
            disabled={!unfrozenCount}
            onClick={() => setFreezeOpen(true)}
          >
            冻结新移交包
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        message="批次核对规则"
        description={
          <Timeline
            items={[
              { color: 'blue', children: '历史数据批次号缺失时统一回填为初始批次 B2026-S00-INIT，记录每并入一次补交批次内容版本 +1。' },
              { color: 'gold', children: '坐标一改动，靠它判出的“坐标格式无效”和“同环号地点跳变”先标记失效（保留已接受/退回结论），再按新值重新确认；不成立的复核关闭，仍成立的生成新问题接续旧问题。' },
              { color: 'green', children: '冻结移交包对记录、问题和当时处置结论做快照；之后到达的更正不覆盖冻结值，只进入“待核对差异”列表，可采纳或驳回。' },
            ]}
          />
        }
      />

      <Card className="tool-card" variant="borderless">
        <Descriptions size="small" column={4}>
          <Descriptions.Item label="记录总数">{records.length.toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="未冻结 / 可继续核对">
            <Tag color="gold">{unfrozenCount.toLocaleString()}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="已冻结记录">
            <Tag icon={<LockOutlined />} color="blue">{frozenCount.toLocaleString()}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="待核对差异">
            <Tag icon={<WarningOutlined />} color={pendingDiffCount ? 'volcano' : 'green'}>
              {pendingDiffCount}
            </Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        className="table-card"
        title={
          <Space>
            <InboxOutlined />
            <span>补交 / 更正批次</span>
            <Tag>{batches.filter((batch) => batch.status === 'pending').length} 个待并入</Tag>
          </Space>
        }
        variant="borderless"
      >
        <Table<IngestBatch>
          rowKey="batchNo"
          size="small"
          bordered
          columns={batchColumns}
          dataSource={batches}
          pagination={false}
          scroll={{ x: 1300 }}
        />
      </Card>

      <Card
        className="table-card"
        title={
          <Space>
            <LockOutlined />
            <span>冻结移交包</span>
            <Tag>{packages.length} 个版本</Tag>
          </Space>
        }
        variant="borderless"
      >
        {packages.length ? (
          <Table<TransferPackage>
            rowKey="version"
            size="small"
            bordered
            columns={packageColumns}
            dataSource={packages}
            pagination={false}
            scroll={{ x: 1100 }}
          />
        ) : (
          <Empty description="尚未冻结移交包。完成本轮核对后点击右上角“冻结新移交包”。" />
        )}
      </Card>

      <Card
        className="table-card"
        title={
          <Space>
            <WarningOutlined />
            <span>待核对差异（冻结记录 vs 后到更正）</span>
            <Tag color={pendingDiffs.length ? 'volcano' : 'green'}>{differences.length} 条</Tag>
          </Space>
        }
        variant="borderless"
      >
        {differences.length ? (
          <Table<PendingDifference>
            rowKey="id"
            size="small"
            bordered
            columns={diffColumns}
            dataSource={differences}
            pagination={false}
            scroll={{ x: 1500, y: 360 }}
          />
        ) : (
          <Empty description="暂无差异。先冻结移交包，再并入冻结之后到达的补交批次即可生成。" />
        )}
      </Card>

      <Modal
        title="冻结新移交包"
        open={freezeOpen}
        okText="确认冻结"
        cancelText="取消"
        onCancel={() => setFreezeOpen(false)}
        onOk={runFreeze}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`将冻结当前 ${unfrozenCount.toLocaleString()} 条未冻结记录及其问题、处置结论。冻结后该部分历史不可回滚，后到更正只会形成待核对差异。`}
        />
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            value={freezeName}
            onChange={(event) => setFreezeName(event.target.value)}
            placeholder="移交包名称"
            prefix={<CopyOutlined />}
          />
          <Input.TextArea
            rows={3}
            value={freezeNote}
            onChange={(event) => setFreezeNote(event.target.value)}
            placeholder="冻结说明（可选）：包含的监测范围、遗留问题处理口径等"
          />
        </Space>
      </Modal>

      <Modal
        title={reviewStatus === 'accepted' ? '采纳待核对差异' : '驳回待核对差异'}
        open={Boolean(reviewTarget)}
        okText={reviewStatus === 'accepted' ? '确认采纳' : '确认驳回'}
        okButtonProps={{ danger: reviewStatus === 'rejected' }}
        cancelText="取消"
        onCancel={() => setReviewTarget(null)}
        onOk={submitReview}
      >
        {reviewTarget && (
          <Space direction="vertical" style={{ width: '100%' }}>
          <Descriptions size="small" column={1} bordered
            items={[
              { key: 'record', label: '记录 / 批次', children: `${reviewTarget.recordId} · ${reviewTarget.batchNo} → ${reviewTarget.packageVersion}` },
              { key: 'field', label: '字段', children: String(reviewTarget.field) },
              { key: 'frozen', label: '冻结值', children: reviewTarget.frozenValue || '空' },
              { key: 'incoming', label: '后到更正值', children: reviewTarget.incomingValue || '空' },
            ]}
          />
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            采纳仅表示核对人员认可差异并登记结论，<strong>不会改写冻结移交包内的值</strong>；如需更新，请在下一版移交包处理。
          </Typography.Paragraph>
          <Input.TextArea
            rows={3}
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="核对说明（可选）"
          />
          </Space>
        )}
      </Modal>
    </div>
  )
}
