import {
  CheckOutlined,
  CloseOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  ExportOutlined,
  LockOutlined,
} from '@ant-design/icons'
import {
  App as AntdApp,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Dropdown,
  Empty,
  Modal,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Timeline,
  Typography,
  type MenuProps,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo, useState } from 'react'
import { useValidationStore } from '../stores/validationStore'
import type { DiffStatus, HandoverPackage, RecordDiff } from '../types'
import { exportRecordsCsv, exportTransferJson } from '../utils/exporters'

const diffStatusMeta: Record<DiffStatus, { label: string; color: string }> = {
  pending: { label: '待核对', color: 'processing' },
  accepted: { label: '已确认', color: 'green' },
  rejected: { label: '已驳回', color: 'default' },
}

function pendingCount(pkg: HandoverPackage) {
  return pkg.diffs.filter((diff) => diff.status === 'pending').length
}

export function BatchesPage() {
  const { message, modal } = AntdApp.useApp()
  const records = useValidationStore((state) => state.records)
  const issues = useValidationStore((state) => state.issues)
  const operations = useValidationStore((state) => state.operations)
  const batches = useValidationStore((state) => state.batches)
  const packages = useValidationStore((state) => state.packages)
  const freezePackage = useValidationStore((state) => state.freezePackage)
  const applySupplementaryBatch = useValidationStore((state) => state.applySupplementaryBatch)
  const resolveDiff = useValidationStore((state) => state.resolveDiff)

  const [activePackageId, setActivePackageId] = useState<string | null>(null)
  const [diffStatus, setDiffStatus] = useState<DiffStatus | 'all'>('pending')

  const activePackage =
    packages.find((pkg) => pkg.id === activePackageId) ?? packages[0] ?? null

  const filteredDiffs = useMemo(() => {
    if (!activePackage) return []
    return activePackage.diffs.filter((diff) =>
      diffStatus === 'all' ? true : diff.status === diffStatus,
    )
  }, [activePackage, diffStatus])

  const handleFreeze = () => {
    modal.confirm({
      title: '冻结当前数据为移交包？',
      content: '冻结后记录与问题结论封版；后到更正不再吸收，仅列待核对差异。已确认的差异会在下一版吸收。',
      okText: '冻结版本',
      onOk: () => {
        freezePackage()
        void message.success('已冻结新的移交版本')
      },
    })
  }

  const handleSupplement = () => {
    modal.confirm({
      title: '模拟收到监测站补交更正批次？',
      content:
        '将按地点主表与上一条同环号记录，对坐标无效和地点跳变记录提交更正值。未冻结记录直接吸收并重新校验；已冻结记录只登记待核对差异。',
      okText: '收到补交批次',
      onOk: () => {
        const result = applySupplementaryBatch()
        if (result.applied || result.diffed) {
          void message.success(
            `批次 ${result.batchId}：${result.applied} 条已吸收，${result.diffed} 条列入待核对差异`,
          )
        } else {
          void message.info('当前没有需要补交更正的记录')
        }
      },
    })
  }

  const columns: ColumnsType<RecordDiff> = [
    { title: '记录编号', dataIndex: 'recordId', width: 130, fixed: 'left' },
    {
      title: '字段',
      dataIndex: 'fieldLabel',
      width: 110,
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: '冻结值',
      dataIndex: 'frozenValue',
      width: 170,
      ellipsis: true,
      render: (value: string) => <Typography.Text code>{value || '空'}</Typography.Text>,
    },
    {
      title: '后到更正',
      dataIndex: 'incomingValue',
      width: 170,
      ellipsis: true,
      render: (value: string) => <Typography.Text type="success">{value || '空'}</Typography.Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: DiffStatus) => (
        <Tag color={diffStatusMeta[value].color}>{diffStatusMeta[value].label}</Tag>
      ),
    },
    {
      title: '发现时间',
      dataIndex: 'detectedAt',
      width: 170,
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '核对操作',
      key: 'actions',
      width: 170,
      fixed: 'right',
      render: (_, diff) =>
        diff.status === 'pending' ? (
          <Space>
            <Button
              size="small"
              type="link"
              icon={<CheckOutlined />}
              onClick={() => {
                if (activePackage) {
                  resolveDiff(activePackage.id, diff.id, 'accepted')
                  void message.success('已确认差异，将计入下一冻结版本')
                }
              }}
            >
              确认
            </Button>
            <Button
              size="small"
              type="link"
              danger
              icon={<CloseOutlined />}
              onClick={() => {
                if (activePackage) {
                  resolveDiff(activePackage.id, diff.id, 'rejected')
                  void message.success('已驳回该差异，不进入下一版本')
                }
              }}
            >
              驳回
            </Button>
          </Space>
        ) : (
          <Typography.Text type="secondary">已核对</Typography.Text>
        ),
    },
  ]

  const exportMenu: MenuProps['items'] = [
    { key: 'csv', label: '区域中心 CSV（含批次号 / 冻结版本 / 差异条数）', icon: <DownloadOutlined /> },
    { key: 'json', label: '区域中心 JSON（含冻结版本与待核对差异）', icon: <ExportOutlined /> },
  ]

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>移交批次与冻结</Typography.Title>
          <Typography.Paragraph type="secondary">
            把记录、校验结论、处置历史和移交包接成可续作的批次核对：后到更正先失效旧判定、再按新值确认；冻结记录不再吸收更正，只列待核对差异。
          </Typography.Paragraph>
        </div>
        <Space>
          <Button icon={<CloudUploadOutlined />} onClick={handleSupplement}>
            收到补交更正批次
          </Button>
          <Button type="primary" icon={<LockOutlined />} onClick={handleFreeze}>
            冻结移交包
          </Button>
          <Dropdown
            menu={{
              items: exportMenu,
              onClick: ({ key }) => {
                if (key === 'csv') exportRecordsCsv(records, issues, packages)
                else exportTransferJson(records, issues, operations, packages, batches)
                void message.success('移交文件已生成，含批次号、冻结版本与差异条数')
              },
            }}
          >
            <Button icon={<ExportOutlined />}>导出移交数据</Button>
          </Dropdown>
        </Space>
      </div>

      <Row gutter={12}>
        <Col span={6}>
          <Card variant="borderless" className="batch-stat-card">
            <Statistic
              title="当前批次"
              value={batches[batches.length - 1]?.id || '—'}
              valueStyle={{ fontSize: 18 }}
            />
            <Typography.Text type="secondary" className="batch-stat-hint">
              {batches[batches.length - 1]?.label}
            </Typography.Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card variant="borderless" className="batch-stat-card">
            <Statistic
              title="已冻结版本"
              value={packages.length ? `v${packages[0].version}` : '未冻结'}
              valueStyle={{ fontSize: 18 }}
            />
            <Typography.Text type="secondary" className="batch-stat-hint">
              {packages.length ? packages[0].batchLabel : '冻结后才会封版'}
            </Typography.Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card variant="borderless" className="batch-stat-card">
            <Statistic
              title="冻结记录数"
              value={packages[0]?.recordCount ?? 0}
              valueStyle={{ fontSize: 18 }}
            />
            <Typography.Text type="secondary" className="batch-stat-hint">
              封版时的记录条数
            </Typography.Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card variant="borderless" className="batch-stat-card">
            <Badge count={packages[0] ? pendingCount(packages[0]) : 0} offset={[-6, 4]}>
              <Statistic
                title="待核对差异"
                value={packages[0] ? pendingCount(packages[0]) : 0}
                valueStyle={{ fontSize: 18, color: '#cf3f45' }}
              />
            </Badge>
            <Typography.Text type="secondary" className="batch-stat-hint">
              后到更正与冻结值的差异
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      <Card className="table-card" title="冻结版本" variant="borderless">
        {packages.length ? (
          <Timeline
            items={packages.map((pkg) => ({
              color: pkg.version === packages[0].version ? 'green' : 'gray',
              children: (
                <div
                  key={pkg.id}
                  className={`package-row${activePackage?.id === pkg.id ? ' package-row--active' : ''}`}
                  onClick={() => setActivePackageId(pkg.id)}
                >
                  <Space wrap>
                    <Tag color="blue">v{pkg.version}</Tag>
                    <strong>{pkg.batchLabel}</strong>
                    <span className="muted-text">{pkg.batchId}</span>
                    <span className="muted-text">
                      {new Date(pkg.frozenAt).toLocaleString('zh-CN')}
                    </span>
                    <Tag>{pkg.recordCount.toLocaleString()} 条记录</Tag>
                    {pendingCount(pkg) > 0 && <Badge count={pendingCount(pkg)} />}
                    {pkg.diffs.filter((d) => d.status === 'accepted').length > 0 && (
                      <Tag color="green">
                        {pkg.diffs.filter((d) => d.status === 'accepted').length} 条已确认入下一版
                      </Tag>
                    )}
                  </Space>
                  <div className="package-note">{pkg.note}</div>
                </div>
              ),
            }))}
          />
        ) : (
          <Empty description="还没有冻结版本。点击右上角“冻结移交包”封版当前记录与问题结论。" />
        )}
      </Card>

      <Card
        className="table-card"
        title={
          activePackage
            ? `待核对差异 · v${activePackage.version}（${activePackage.batchId}）`
            : '待核对差异'
        }
        variant="borderless"
        extra={
          <Space>
            <Tag
              color={diffStatus === 'pending' ? 'processing' : 'default'}
              onClick={() => setDiffStatus('pending')}
              className="diff-filter-tag"
            >
              待核对 {activePackage ? pendingCount(activePackage) : 0}
            </Tag>
            <Tag
              color={diffStatus === 'all' ? 'blue' : 'default'}
              onClick={() => setDiffStatus('all')}
              className="diff-filter-tag"
            >
              全部 {activePackage?.diffs.length ?? 0}
            </Tag>
          </Space>
        }
      >
        {activePackage ? (
          <Table<RecordDiff>
            rowKey="id"
            size="small"
            bordered
            columns={columns}
            dataSource={filteredDiffs}
            pagination={false}
            scroll={{ x: 1100, y: 420 }}
            locale={{ emptyText: '当前版本没有差异。收到补交更正批次后，差异会列在这里。' }}
          />
        ) : (
          <Empty description="冻结移交包后，后到更正与冻结值的差异会列在这里供核对。" />
        )}
      </Card>

      <Card className="audit-note" variant="borderless">
        <Descriptions
          size="small"
          column={1}
          items={[
            { key: 'batch', label: '批次号回填', children: '已有数据批次号缺失的，统一回填为初始批次 PC-2026-INITIAL。' },
            { key: 'freeze', label: '冻结版本', children: '冻结时保存记录与问题结论快照，版本号连续递增。' },
            { key: 'diff', label: '差异续作', children: '已冻结记录不吸收后到更正；差异待人工确认或驳回，确认的差异计入下一冻结版本。' },
            { key: 'export', label: '导出口径', children: 'CSV 与 JSON 均携带批次号、冻结版本与待核对差异条数。' },
          ]}
        />
      </Card>
    </div>
  )
}
