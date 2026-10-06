import {
  CheckOutlined,
  DownloadOutlined,
  ExportOutlined,
  FilterOutlined,
  LinkOutlined,
  LockOutlined,
  ReloadOutlined,
  RollbackOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import {
  App as AntdApp,
  Button,
  Card,
  Dropdown,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  type MenuProps,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ISSUE_RULES } from '../data/mockRecords'
import { filterIssues, useValidationStore } from '../stores/validationStore'
import type { IssueSeverity, IssueStatus, ValidationIssue } from '../types'
import { exportRecordsCsv, exportTransferJson, exportValidationCsv } from '../utils/exporters'
import { IssueDetailDrawer } from '../components/IssueDetailDrawer'
import { StatsCards } from '../components/StatsCards'

const severityMeta: Record<IssueSeverity, { label: string; color: string }> = {
  error: { label: '错误', color: 'red' },
  warning: { label: '警告', color: 'gold' },
  review: { label: '待确认', color: 'blue' },
}
const statusMeta: Record<IssueStatus, { label: string; color: string }> = {
  open: { label: '待处理', color: 'processing' },
  accepted: { label: '已接受', color: 'green' },
  returned: { label: '已退回', color: 'volcano' },
  corrected: { label: '已修正', color: 'cyan' },
  invalidated: { label: '已失效待重认', color: 'default' },
}

export function ValidationPage() {
  const { message, modal } = AntdApp.useApp()
  const navigate = useNavigate()
  const records = useValidationStore((state) => state.records)
  const issues = useValidationStore((state) => state.issues)
  const operations = useValidationStore((state) => state.operations)
  const batches = useValidationStore((state) => state.batches)
  const packages = useValidationStore((state) => state.packages)
  const differences = useValidationStore((state) => state.differences)
  const selectedIssueIds = useValidationStore((state) => state.selectedIssueIds)
  const setSelectedIssueIds = useValidationStore((state) => state.setSelectedIssueIds)
  const batchFix = useValidationStore((state) => state.batchFix)
  const acceptIssues = useValidationStore((state) => state.acceptIssues)
  const returnIssues = useValidationStore((state) => state.returnIssues)
  const updateRecord = useValidationStore((state) => state.updateRecord)
  const rollback = useValidationStore((state) => state.rollback)
  const reset = useValidationStore((state) => state.reset)
  const [severity, setSeverity] = useState<IssueSeverity | 'all'>('all')
  const [status, setStatus] = useState<IssueStatus | 'all'>('open')
  const [issueType, setIssueType] = useState<ValidationIssue['type'] | 'all'>('all')
  const [keyword, setKeyword] = useState('')
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')

  const filtered = useMemo(
    () => filterIssues(issues, { severity, status, type: issueType, keyword }),
    [issues, issueType, keyword, severity, status],
  )
  const recordById = useMemo(() => new Map(records.map((record) => [record.id, record])), [records])
  const activeIssue = issues.find((issue) => issue.id === activeIssueId) ?? null
  const activeRecord = records.find((record) => record.id === activeIssue?.recordId) ?? null
  const frozen = packages.length > 0
  const canRollback = !frozen && operations.some((operation) => !operation.rolledBack)
  const invalidatedCount = issues.filter((issue) => issue.status === 'invalidated').length

  const ruleItems: MenuProps['items'] = ISSUE_RULES.filter((rule) => rule.correctionMode === 'automatic').map((rule) => ({
    key: rule.type,
    label: `${rule.label}（${issues.filter((issue) => issue.type === rule.type && issue.status === 'open').length}）`,
  }))

  const runBatchFix = (type: string) => {
    const count = batchFix(type as ValidationIssue['type'])
    void message.success(count ? `已按规则修正 ${count} 条问题` : '当前没有可自动修正的问题')
  }

  const jumpToIssue = (issueId: string) => {
    setStatus('all')
    setActiveIssueId(issueId)
  }

  const columns: ColumnsType<ValidationIssue> = [
    {
      title: '级别',
      dataIndex: 'severity',
      width: 90,
      fixed: 'left',
      filters: Object.entries(severityMeta).map(([value, meta]) => ({ text: meta.label, value })),
      onFilter: (value, record) => record.severity === value,
      render: (value: IssueSeverity) => (
        <Tag color={severityMeta[value].color}>{severityMeta[value].label}</Tag>
      ),
    },
    { title: '记录编号', dataIndex: 'recordId', width: 120, fixed: 'left' },
    { title: '问题', dataIndex: 'title', width: 190, ellipsis: true },
    {
      title: '说明',
      dataIndex: 'description',
      width: 340,
      ellipsis: true,
      render: (value: string, record) => (
        <div>
          <div>{value}</div>
          {record.status === 'invalidated' && record.invalidatedReason && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              失效原因：{record.invalidatedReason}
              {record.previousStatus === 'accepted' && '（原结论：已接受）'}
              {record.previousStatus === 'returned' && '（原结论：已退回）'}
            </Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: '批次/冻结',
      key: 'batch',
      width: 180,
      render: (_: unknown, record) => {
        const frozenVersion = recordById.get(record.recordId)?.frozenVersion
        return (
          <Space size={4} wrap>
            <Tag style={{ marginInlineEnd: 0 }}>{record.batchNo}</Tag>
            {frozenVersion && <Tag icon={<LockOutlined />} color="blue">{frozenVersion}</Tag>}
          </Space>
        )
      },
    },
    {
      title: '当前值',
      dataIndex: 'currentValue',
      width: 170,
      ellipsis: true,
      render: (value: string) => <Typography.Text code>{value || '空'}</Typography.Text>,
    },
    {
      title: '建议值',
      dataIndex: 'suggestedValue',
      width: 170,
      ellipsis: true,
      render: (value: string) =>
        value ? <span className="suggested-value">{value}</span> : <Typography.Text type="secondary">需人工判定</Typography.Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (value: IssueStatus, record) => (
        <Space direction="vertical" size={2}>
          <Tag color={statusMeta[value].color}>{statusMeta[value].label}</Tag>
          {record.reopenedFrom && (
            <Typography.Link
              type="secondary"
              style={{ fontSize: 12 }}
              onClick={() => jumpToIssue(record.reopenedFrom!)}
            >
              <LinkOutlined /> 接续旧问题
            </Typography.Link>
          )}
          {record.supersededBy && (
            <Typography.Link
              type="secondary"
              style={{ fontSize: 12 }}
              onClick={() => jumpToIssue(record.supersededBy!)}
            >
              <LinkOutlined /> 已由新问题接续
            </Typography.Link>
          )}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 120,
      render: (_, record) => (
        <Button type="link" size="small" onClick={() => setActiveIssueId(record.id)}>
          核验处置
        </Button>
      ),
    },
  ]

  return (
    <div className="page-stack">
      <StatsCards totalRecords={records.length} issues={issues} />
      {invalidatedCount > 0 && status === 'open' && (
        <Card size="small" className="frozen-banner" variant="borderless">
          <Space>
            <Tag color="default">{invalidatedCount} 条问题因坐标/鸟种更正已失效</Tag>
            <span>坐标一改动，靠它判出的问题先失效再按新值重新确认；</span>
            <Button size="small" type="link" onClick={() => setStatus('invalidated')}>
              查看失效与接续情况
            </Button>
          </Space>
        </Card>
      )}
      {frozen && (
        <Card size="small" className="frozen-banner" variant="borderless">
          <Space>
            <LockOutlined />
            <span>
              已有 {packages.length} 个冻结移交包；冻结记录与处置结论只读，后到更正请在
              <Typography.Link strong onClick={() => navigate('/batches')}>
                「批次核对」
              </Typography.Link>
              中按待核对差异处理。
            </span>
            {differences.some((diff) => diff.status === 'pending') && (
              <Tag color="volcano">{differences.filter((d) => d.status === 'pending').length} 条差异待核对</Tag>
            )}
          </Space>
        </Card>
      )}
      <Card className="tool-card" variant="borderless">
        <div className="toolbar-row">
          <Space wrap>
            <Select
              value={severity}
              style={{ width: 128 }}
              onChange={setSeverity}
              options={[
                { value: 'all', label: '全部级别' },
                ...Object.entries(severityMeta).map(([value, meta]) => ({ value, label: meta.label })),
              ]}
            />
            <Select
              value={status}
              style={{ width: 150 }}
              onChange={setStatus}
              options={[
                { value: 'all', label: '全部状态' },
                ...Object.entries(statusMeta).map(([value, meta]) => ({ value, label: meta.label })),
              ]}
            />
            <Select
              value={issueType}
              style={{ width: 190 }}
              onChange={setIssueType}
              options={[
                { value: 'all', label: '全部问题类型' },
                ...ISSUE_RULES.map((rule) => ({ value: rule.type, label: rule.label })),
              ]}
            />
            <Input.Search
              allowClear
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索记录、问题或说明"
              style={{ width: 250 }}
            />
            <span className="filter-count"><FilterOutlined /> 当前 {filtered.length.toLocaleString()} 条</span>
          </Space>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => {
              modal.confirm({
                title: '重新载入内置数据？',
                content: '当前处置、补交批次、冻结包和操作历史将被清空。',
                okText: '重新载入',
                onOk: reset,
              })
            }}>
              重新载入
            </Button>
          </Space>
        </div>
        <div className="toolbar-row toolbar-row--secondary">
          <Space wrap>
            <span className="toolbar-label">批量处置</span>
            <Dropdown menu={{ items: ruleItems, onClick: ({ key }) => runBatchFix(key) }} trigger={['click']}>
              <Button type="primary" icon={<ToolOutlined />}>按规则修正</Button>
            </Dropdown>
            <Button
              icon={<CheckOutlined />}
              disabled={!selectedIssueIds.length}
              onClick={() => acceptIssues(selectedIssueIds)}
            >
              接受所选
            </Button>
            <Button
              danger
              disabled={!selectedIssueIds.length}
              onClick={() => setReturnOpen(true)}
            >
              退回并说明
            </Button>
          </Space>
          <Space>
            <Button icon={<DownloadOutlined />} onClick={() => exportValidationCsv(issues, records)}>
              导出问题 CSV
            </Button>
            <Dropdown
              menu={{
                items: [
                  { key: 'csv', label: '区域中心 CSV', icon: <DownloadOutlined /> },
                  { key: 'json', label: '区域中心 JSON', icon: <ExportOutlined /> },
                ],
                onClick: ({ key }) => {
                  if (key === 'csv') exportRecordsCsv(records, issues, differences)
                  else exportTransferJson(records, issues, operations, batches, packages, differences)
                  void message.success('移交文件已生成（含批次号、冻结版本与差异条数）')
                },
              }}
            >
              <Button type="primary">导出移交数据</Button>
            </Dropdown>
            <Tooltip title={frozen ? '存在冻结移交包，处置历史已进入审计链路，不可回滚' : '回滚最近一次操作'}>
              <Button
                icon={<RollbackOutlined />}
                disabled={!canRollback}
                onClick={() => {
                  const target = operations.find((operation) => !operation.rolledBack)
                  if (target) {
                    rollback(target.id)
                    void message.success(`已回滚：${target.title}`)
                  }
                }}
              >
                回滚最近操作
              </Button>
            </Tooltip>
          </Space>
        </div>
      </Card>
      <Card className="table-card" variant="borderless">
        <Table<ValidationIssue>
          virtual
          rowKey="id"
          size="small"
          bordered
          columns={columns}
          dataSource={filtered}
          pagination={false}
          scroll={{ x: 1500, y: 480 }}
          rowSelection={{
            selectedRowKeys: selectedIssueIds,
            onChange: (keys) => setSelectedIssueIds(keys.map(String)),
            preserveSelectedRowKeys: true,
            getCheckboxProps: (record) => ({
              disabled:
                record.status !== 'open' ||
                Boolean(recordById.get(record.recordId)?.frozenVersion),
            }),
          }}
          onRow={(record) => ({
            onDoubleClick: () => setActiveIssueId(record.id),
          })}
        />
      </Card>
      <IssueDetailDrawer
        issue={activeIssue}
        record={activeRecord}
        onClose={() => setActiveIssueId(null)}
        onAccept={() => {
          if (activeIssue) {
            acceptIssues([activeIssue.id])
            setActiveIssueId(null)
            void message.success('已接受原记录')
          }
        }}
        onReturn={(reason) => {
          if (activeIssue) {
            returnIssues([activeIssue.id], reason)
            setActiveIssueId(null)
            void message.success('已退回来源班组')
          }
        }}
        onSave={(value, reason) => {
          if (activeIssue && activeRecord) {
            updateRecord(activeRecord.id, { [activeIssue.field]: value }, reason)
            setActiveIssueId(null)
            void message.success('修正已保存，原值可回滚')
          }
        }}
      />
      <Modal
        title="填写退回来因"
        open={returnOpen}
        okText="确认退回"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: !returnReason.trim() }}
        onCancel={() => setReturnOpen(false)}
        onOk={() => {
          returnIssues(selectedIssueIds, returnReason)
          setReturnOpen(false)
          setReturnReason('')
          void message.success('所选问题已退回')
        }}
      >
        <Input.TextArea
          rows={4}
          value={returnReason}
          onChange={(event) => setReturnReason(event.target.value)}
          placeholder="请说明需要来源班组补充或核对的材料"
        />
      </Modal>
    </div>
  )
}
