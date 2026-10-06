import { CheckOutlined, CloseOutlined, EditOutlined, LockOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Space,
  Tag,
  Timeline,
  Typography,
} from 'antd'
import { useEffect, useState } from 'react'
import type { BirdRecord, ValidationIssue } from '../types'

interface IssueDetailDrawerProps {
  issue: ValidationIssue | null
  record: BirdRecord | null
  onClose: () => void
  onAccept: () => void
  onReturn: (reason: string) => void
  onSave: (value: string, reason: string) => void
}

const severityLabels = { error: '错误', warning: '警告', review: '待确认' }
const previousStatusLabels = {
  accepted: '已接受',
  returned: '已退回',
  corrected: '已修正',
}

export function IssueDetailDrawer({
  issue,
  record,
  onClose,
  onAccept,
  onReturn,
  onSave,
}: IssueDetailDrawerProps) {
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    setValue(issue?.suggestedValue || issue?.currentValue || '')
    setReason('')
  }, [issue])

  if (!issue || !record) return null
  const color = issue.severity === 'error' ? 'red' : issue.severity === 'warning' ? 'gold' : 'blue'
  const frozen = Boolean(record.frozenVersion)
  const readOnly = issue.status !== 'open' || frozen

  return (
    <Drawer
      width={560}
      open
      title="问题核验与处置"
      onClose={onClose}
      extra={
        <Space size={4}>
          {frozen && <Tag icon={<LockOutlined />} color="blue">已冻结 {record.frozenVersion}</Tag>}
          <Tag color={color}>{severityLabels[issue.severity]}</Tag>
        </Space>
      }
      footer={
        !readOnly ? (
          <Space>
            <Button icon={<CloseOutlined />} onClick={() => reason.trim() && onReturn(reason)}>
              退回并说明
            </Button>
            <Button icon={<CheckOutlined />} onClick={onAccept}>
              接受现状
            </Button>
            <Button
              type="primary"
              icon={<EditOutlined />}
              disabled={!value.trim()}
              onClick={() => onSave(value.trim(), reason.trim())}
            >
              保存修正
            </Button>
          </Space>
        ) : (
          <Space>
            <Tag color="green">
              {frozen
                ? '该记录已冻结进移交包，处置只读'
                : issue.status === 'invalidated'
                  ? '该问题依据已变化并失效'
                  : '该问题已处置'}
            </Tag>
          </Space>
        )
      }
    >
      <Alert
        showIcon
        type={issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'}
        message={issue.title}
        description={issue.description}
      />
      {issue.status === 'invalidated' && (
        <Alert
          showIcon
          type="warning"
          style={{ marginTop: 12 }}
          message="判定依据变化，问题已失效"
          description={
            <Timeline
              items={[
                {
                  color: 'gray',
                  children: (
                    <>
                      失效时间：{issue.invalidatedAt ? new Date(issue.invalidatedAt).toLocaleString('zh-CN') : '-'}
                      <br />
                      {issue.invalidatedReason}
                    </>
                  ),
                },
                ...(issue.previousStatus
                  ? [
                      {
                        color: 'gold' as const,
                        children: `坐标/依据变化前的人工结论：${previousStatusLabels[issue.previousStatus]}（该结论未被冲掉，随原问题留痕）`,
                      },
                    ]
                  : []),
                ...(issue.supersededBy
                  ? [
                      {
                        color: 'blue' as const,
                        children: `按新值重新确认后由新问题 ${issue.supersededBy} 接续。`,
                      },
                    ]
                  : issue.status === 'invalidated'
                    ? [
                        {
                          color: 'green' as const,
                          children: '按新值复核后问题不再成立，无需重新打开。',
                        },
                      ]
                    : []),
              ]}
            />
          }
        />
      )}
      <Descriptions
        className="issue-descriptions"
        title="记录上下文"
        column={1}
        size="small"
        items={[
          { key: 'id', label: '记录编号', children: record.id },
          {
            key: 'batch',
            label: '批次 / 版本',
            children: `${issue.batchNo} · 记录 v${record.version}${record.frozenVersion ? ` · 冻结于 ${record.frozenVersion}` : ''}`,
          },
          { key: 'source', label: '来源文件', children: record.sourceFile },
          { key: 'time', label: '观察时间', children: record.observedAt },
          { key: 'location', label: '观察地点', children: record.location },
          { key: 'ring', label: '环号', children: `${record.rawRingCode} → ${record.normalizedRingCode}` },
          {
            key: 'species',
            label: '鸟种',
            children: `${record.speciesRaw} → ${record.speciesCanonical} (${record.scientificName})`,
          },
        ]}
      />
      <div className="drawer-section">
        <Typography.Title level={5}>判定依据</Typography.Title>
        <Typography.Paragraph>{issue.suggestion}</Typography.Paragraph>
      </div>
      <Form layout="vertical">
        <Form.Item label={`修正字段：${String(issue.field)}`}>
          <Input.TextArea
            value={value}
            rows={3}
            disabled={readOnly}
            onChange={(event) => setValue(event.target.value)}
            placeholder="输入经核实后的值"
          />
        </Form.Item>
        <Form.Item label="退回原因">
          <Input.TextArea
            value={reason}
            rows={2}
            disabled={readOnly}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例如：需要核对原始纸质登记表照片"
          />
        </Form.Item>
      </Form>
    </Drawer>
  )
}
