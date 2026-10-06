import {
  CloudUploadOutlined,
  ClockCircleOutlined,
  LockOutlined,
  RollbackOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { App as AntdApp, Button, Card, Empty, List, Popconfirm, Space, Tag, Timeline, Typography } from 'antd'
import { useValidationStore } from '../stores/validationStore'

const actionLabels = {
  batch_fix: { label: '批量修正', color: 'cyan' },
  accept: { label: '接受', color: 'green' },
  return: { label: '退回', color: 'volcano' },
  manual_edit: { label: '人工编辑', color: 'blue' },
  reset: { label: '重置', color: 'default' },
  ingest: { label: '补交批次并入', color: 'geekblue' },
  freeze: { label: '冻结移交包', color: 'purple' },
  diff_review: { label: '差异核对', color: 'gold' },
}

export function HistoryPage() {
  const { message } = AntdApp.useApp()
  const operations = useValidationStore((state) => state.operations)
  const packages = useValidationStore((state) => state.packages)
  const rollback = useValidationStore((state) => state.rollback)
  const frozen = packages.length > 0

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>操作历史与回滚</Typography.Title>
          <Typography.Paragraph type="secondary">
            每次补交并入、批量修正、接受、退回、人工编辑或冻结都会保存操作前快照。
            冻结移交包生成后，处置历史进入冻结审计链路，不再允许回滚。
          </Typography.Paragraph>
        </div>
        <Tag icon={<SafetyCertificateOutlined />} color="green">审计记录仅保存在本机</Tag>
      </div>
      {frozen && (
        <Card size="small" className="frozen-banner" variant="borderless">
          <Space>
            <LockOutlined />
            <span>
              已冻结 {packages.map((pkg) => pkg.version).join('、')}：历史只可追溯不可恢复；后到更正请走「批次核对」的待核对差异流程。
            </span>
          </Space>
        </Card>
      )}
      <Card className="table-card history-card" variant="borderless">
        {operations.length ? (
          <List
            itemLayout="horizontal"
            dataSource={operations}
            renderItem={(operation) => {
              const meta = actionLabels[operation.action]
              const protectedByFreeze = frozen || Boolean(operation.frozenSince)
              return (
                <List.Item
                  actions={[
                    <Popconfirm
                      key="rollback"
                      title="回滚到该操作之前？"
                      description={
                        protectedByFreeze
                          ? '冻结移交包已生成，该操作属于冻结审计链路，不能回滚。'
                          : '该操作之后的所有修改也会被覆盖。'
                      }
                      okText="确认回滚"
                      cancelText="取消"
                      disabled={operation.rolledBack || protectedByFreeze}
                      onConfirm={() => {
                        rollback(operation.id)
                        void message.success(`已回滚：${operation.title}`)
                      }}
                    >
                      <Button
                        type="link"
                        icon={protectedByFreeze ? <LockOutlined /> : <RollbackOutlined />}
                        disabled={operation.rolledBack || protectedByFreeze}
                      >
                        {operation.rolledBack ? '已回滚' : protectedByFreeze ? '冻结保护中' : '恢复此版本'}
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      operation.action === 'ingest' ? (
                        <CloudUploadOutlined className="history-icon" />
                      ) : operation.action === 'freeze' ? (
                        <LockOutlined className="history-icon" />
                      ) : (
                        <ClockCircleOutlined className="history-icon" />
                      )
                    }
                    title={
                      <Space>
                        <Tag color={meta.color}>{meta.label}</Tag>
                        <strong>{operation.title}</strong>
                        <span className="muted-text">{operation.count} 条</span>
                        {operation.frozenSince && (
                          <Tag icon={<LockOutlined />} color="purple">{operation.frozenSince}</Tag>
                        )}
                      </Space>
                    }
                    description={
                      <>
                        <span>{operation.detail}</span>
                        <div className="history-time">
                          {new Date(operation.timestamp).toLocaleString('zh-CN')}
                        </div>
                      </>
                    }
                  />
                </List.Item>
              )
            }}
          />
        ) : (
          <Empty description="还没有修改记录。在批次核对页并入补交批次，或在问题校验页执行处置后，这里会出现可追溯的操作。" />
        )}
      </Card>
      <Card className="audit-note" variant="borderless">
        <Timeline
          items={[
            { color: 'green', children: '操作前保存完整记录、问题、批次与冻结包快照' },
            { color: 'blue', children: '补交批次并入时，坐标类问题先失效再按新值重新确认，人工接受/退回结论随旧问题留痕' },
            { color: 'purple', children: '冻结移交包后的记录不再吸收更正，差异单独列出；冻结后历史不可回滚' },
          ]}
        />
      </Card>
    </div>
  )
}
