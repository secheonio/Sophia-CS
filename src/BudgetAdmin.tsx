import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from './api'
import type { BudgetTableRow, Meta } from './types'

const blankRow = (): BudgetTableRow => ({
  관: '',
  항: '',
  목: '',
  세목: '',
  내역: '',
  예산총액: 0,
  예산잔액: 0,
  집행률: 0,
})

function toSafeNumber(value: number | string | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function BudgetAdmin({ meta, onError, notify }: {
  meta: Meta
  onError: (message: string) => void
  notify: (message: string) => void
}) {
  const [department, setDepartment] = useState(meta.budgetDepartments[0] ?? '기초과정')
  const [rows, setRows] = useState<BudgetTableRow[]>(meta.budgetCatalog[department] ?? [])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRows(meta.budgetCatalog[department] ?? [])
  }, [department, meta.budgetCatalog])

  const summary = useMemo(() => {
    const total = rows.reduce((sum, row) => sum + toSafeNumber(row.예산총액), 0)
    const remaining = rows.reduce((sum, row) => sum + toSafeNumber(row.예산잔액), 0)
    const spent = Math.max(0, total - remaining)
    const rate = total > 0 ? (spent / total) * 100 : 0
    const overBudget = remaining < 0
    const status = overBudget ? '초과 집행' : rate >= 80 ? '집행 집중' : rate >= 50 ? '운영 중' : '안정적'
    const tone = overBudget ? 'high' : rate >= 80 ? 'high' : rate >= 50 ? 'medium' : 'low'
    const warningText = overBudget
      ? '예산 초과 상태입니다. 추가 집행 전 재검토가 필요합니다.'
      : rate >= 80
        ? '집행률이 80%를 넘어서 추가 상신 전에 관리자 검토가 필요합니다.'
        : rate >= 60
          ? '집행률이 증가하고 있어 예산 사용 패턴을 점검해 주세요.'
          : '현재 예산 사용은 안정적입니다.'
    return { total, spent, remaining, rate, status, tone, warningText, overBudget }
  }, [rows])

  const monthlyTrend = useMemo(() => {
    const months = ['1월', '2월', '3월', '4월', '5월', '6월']
    const baseRate = Math.min(100, Math.max(0, summary.rate))
    return months.map((month, index) => {
      const planned = Math.min(100, Math.max(12, baseRate + (index - 2) * 12 + 8))
      const actual = Math.min(100, Math.max(8, baseRate * (0.82 + index * 0.07) + 7))
      return {
        month,
        planned: Number(planned.toFixed(0)),
        actual: Number(actual.toFixed(0)),
      }
    })
  }, [summary.rate])

  const policyAlerts = useMemo(() => {
    const items = []
    if (summary.overBudget) items.push({ label: '초과 집행', detail: '총 잔액이 0원 미만으로 계산되고 있습니다.', level: 'high' })
    if (summary.rate >= 80) items.push({ label: '집행률 경고', detail: '권장 한도 80%를 초과해 추가 예산 사용을 제한할 수 있습니다.', level: 'high' })
    else if (summary.rate >= 60) items.push({ label: '모니터링 필요', detail: '집행률이 증가 추세라 정기 점검이 필요합니다.', level: 'medium' })
    else items.push({ label: '안정 상태', detail: '예산 사용이 균형적이며 추가 상신이 가능해 보입니다.', level: 'low' })
    return items
  }, [summary.overBudget, summary.rate])

  function updateRow(index: number, field: keyof BudgetTableRow, value: string | number) {
    setRows((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) return row
      const next: BudgetTableRow = { ...row }
      if (field === '예산총액' || field === '예산잔액' || field === '집행률') {
        next[field] = toSafeNumber(value) as never
      } else {
        next[field] = String(value) as never
      }
      if (field === '예산총액' || field === '예산잔액') {
        const total = toSafeNumber(next.예산총액)
        const remaining = toSafeNumber(next.예산잔액)
        next.집행률 = total > 0 ? Number((((total - remaining) / total) * 100).toFixed(2)) : 0
      }
      return next
    }))
  }

  async function save() {
    try {
      setSaving(true)
      const normalized = rows.map((row) => ({
        ...row,
        관: String(row.관 ?? '').trim(),
        항: String(row.항 ?? '').trim(),
        목: String(row.목 ?? '').trim(),
        세목: String(row.세목 ?? '').trim(),
        내역: String(row.내역 ?? '').trim(),
        예산총액: Math.max(0, toSafeNumber(row.예산총액)),
        예산잔액: Math.max(0, Math.min(toSafeNumber(row.예산잔액), toSafeNumber(row.예산총액))),
        집행률: Number((row.예산총액 > 0 ? ((toSafeNumber(row.예산총액) - toSafeNumber(row.예산잔액)) / toSafeNumber(row.예산총액)) * 100 : 0).toFixed(2)),
      }))
      await api.saveBudgetMaster(department, normalized)
      notify('예산표를 저장했습니다.')
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : '예산표를 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  function addRow() {
    setRows((current) => [...current, blankRow()])
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))
  }

  return (
    <div className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1>예산표 관리</h1>
          <p>관리자(교장)는 상신 단위별 예산표를 직접 편집하고, 수정한 값은 기안 작성 시 바로 반영됩니다.</p>
        </div>
      </div>

      <section className="budget-admin-panel">
        <div className="panel-heading budget-admin-header">
          <div>
            <h2>상신 단위 예산표</h2>
            <p>행 추가·삭제·금액 수정은 여기서 바로 저장됩니다.</p>
          </div>
          <div className="department-selector-wrap">
            <select value={department} onChange={(event) => setDepartment(event.currentTarget.value)}>
              {meta.budgetDepartments.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <button type="button" className="primary-button" onClick={() => void save()} disabled={saving}>
              {saving ? '저장 중…' : '예산표 저장'}
            </button>
          </div>
        </div>

        <div className="budget-dashboard-layout">
          <div className="budget-dashboard-main">
            <div className="budget-summary-grid">
              <div className="budget-summary-card budget-summary-total">
                <div className="budget-summary-header">
                  <span className="budget-summary-label">총예산</span>
                  <span className="budget-summary-badge tone-low">기준액</span>
                </div>
                <strong>{summary.total.toLocaleString()}원</strong>
              </div>
              <div className="budget-summary-card budget-summary-spent">
                <div className="budget-summary-header">
                  <span className="budget-summary-label">지출액</span>
                  <span className={`budget-summary-badge tone-${summary.tone}`}>{summary.status}</span>
                </div>
                <strong>{summary.spent.toLocaleString()}원</strong>
              </div>
              <div className="budget-summary-card budget-summary-remaining">
                <div className="budget-summary-header">
                  <span className="budget-summary-label">잔액</span>
                  <span className="budget-summary-badge tone-low">유동</span>
                </div>
                <strong>{summary.remaining.toLocaleString()}원</strong>
              </div>
              <div className="budget-summary-card budget-summary-rate">
                <div className="budget-summary-header">
                  <span className="budget-summary-label">집행률</span>
                  <span className={`budget-summary-badge tone-${summary.tone}`}>{summary.rate >= 80 ? '주의' : summary.rate >= 50 ? '보통' : '양호'}</span>
                </div>
                <strong>{summary.rate.toFixed(1)}%</strong>
              </div>
            </div>

            <div className="budget-table-wrap budget-table-admin">
              <table className="budget-table">
                <colgroup>
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '28%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '5%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>관</th>
                    <th>항</th>
                    <th>목</th>
                    <th>세목</th>
                    <th>내역</th>
                    <th>예산 총액</th>
                    <th>예산 잔액</th>
                    <th>집행률</th>
                    <th>삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${department}-${index}`}>
                      <td><input value={row.관} onChange={(event) => updateRow(index, '관', event.currentTarget.value)} /></td>
                      <td><input value={row.항} onChange={(event) => updateRow(index, '항', event.currentTarget.value)} /></td>
                      <td><input value={row.목} onChange={(event) => updateRow(index, '목', event.currentTarget.value)} /></td>
                      <td><input value={row.세목} onChange={(event) => updateRow(index, '세목', event.currentTarget.value)} /></td>
                      <td><input value={row.내역} onChange={(event) => updateRow(index, '내역', event.currentTarget.value)} /></td>
                      <td><input type="number" min="0" value={row.예산총액} onChange={(event) => updateRow(index, '예산총액', Number(event.currentTarget.value))} /></td>
                      <td><input type="number" min="0" value={row.예산잔액} onChange={(event) => updateRow(index, '예산잔액', Number(event.currentTarget.value))} /></td>
                      <td><input type="number" min="0" max="100" step="0.01" value={row.집행률} onChange={(event) => updateRow(index, '집행률', Number(event.currentTarget.value))} /></td>
                      <td><button type="button" className="reject-confirm" onClick={() => removeRow(index)}>삭제</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="budget-admin-actions">
              <button type="button" className="primary-button" onClick={addRow}>행 추가</button>
            </div>
          </div>

          <aside className="budget-dashboard-side">
            <div className="budget-side-panel budget-side-policy">
              <div className="budget-side-title-row">
                <span className="budget-side-kicker">운영 정책</span>
                <span className={`budget-summary-badge tone-${summary.tone}`}>{summary.status}</span>
              </div>
              <div className="budget-policy-metrics">
                <div>
                  <span>집행한도</span>
                  <strong>{Math.min(100, Math.max(0, summary.rate)).toFixed(1)}%</strong>
                </div>
                <div>
                  <span>권장 한도</span>
                  <strong>80%</strong>
                </div>
              </div>
              <div className="budget-alert-box">
                <span className={`budget-alert-dot tone-${summary.tone}`} />
                <p>{summary.warningText}</p>
              </div>
            </div>

            <div className="budget-side-panel budget-side-trend">
              <div className="budget-side-title-row">
                <span className="budget-side-kicker">월별 추세</span>
                <span className="budget-summary-badge tone-low">6M</span>
              </div>
              <div className="budget-trend-chart" aria-label="월별 예산 집행률 추세">
                {monthlyTrend.map((point) => (
                  <div key={point.month} className="budget-trend-group">
                    <div className="budget-trend-bars">
                      <span className="budget-trend-bar planned" style={{ height: `${point.planned}%` }} />
                      <span className="budget-trend-bar actual" style={{ height: `${point.actual}%` }} />
                    </div>
                    <small>{point.month}</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="budget-side-panel budget-side-status">
              <div className="budget-side-title-row">
                <span className="budget-side-kicker">예산 상태</span>
              </div>
              <div className="budget-status-list">
                <div>
                  <span>잔여 여력</span>
                  <strong>{summary.remaining.toLocaleString()}원</strong>
                </div>
                <div>
                  <span>사용 비중</span>
                  <strong>{summary.rate.toFixed(1)}%</strong>
                </div>
                <div>
                  <span>상태 점검</span>
                  <strong>{summary.rate >= 80 ? '재검토 필요' : summary.rate >= 50 ? '허용 범위' : '안정적'}</strong>
                </div>
              </div>
              <div className="budget-policy-alerts">
                {policyAlerts.map((alert) => (
                  <div key={alert.label} className={`budget-policy-alert budget-policy-alert-${alert.level}`}>
                    <span>{alert.label}</span>
                    <small>{alert.detail}</small>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  )
}
