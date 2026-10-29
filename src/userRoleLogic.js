export const AFFILIATION_COLUMNS = ['기초과정', '본과정', '심화과정', '교무부', '생활교육부', '교육과정연구부', '전형위원회', '생활관', '도서관', '델포이', '행정실', '기타']
export const EMPTY_AFFILIATIONS = Object.fromEntries(AFFILIATION_COLUMNS.map((department) => [department, '없음']))

export function toInternalRole(value, department = null) {
  const normalized = typeof value === 'string' ? value.trim() : value
  if (!normalized || normalized === '없음') return null
  if (normalized === '부장') return department === '행정실' ? '행정실장' : '기관장'
  if (normalized === '부서원') return '기안자'
  if (['기안자', '기관장', '교장', '행정실장'].includes(normalized)) return normalized
  return null
}

export function buildDepartmentRoles(user) {
  const base = { ...EMPTY_AFFILIATIONS }
  const departments = Array.isArray(user.departments) ? user.departments : []
  const selectedDepartments = AFFILIATION_COLUMNS.filter((department) => departments.includes(department))
  if (!selectedDepartments.length) return base

  const positionByDepartment = new Map()
  const rawPositions = Array.isArray(user.positions) ? user.positions : []
  for (let index = 0; index < departments.length; index += 1) {
    const department = departments[index]
    const position = rawPositions[index]
    if (AFFILIATION_COLUMNS.includes(department) && position) {
      positionByDepartment.set(department, position)
    }
  }

  const primaryDepartment = selectedDepartments.includes(user.department) ? user.department : selectedDepartments[0]
  const explicitLeadDepartments = selectedDepartments.filter((department) => {
    const mappedPosition = positionByDepartment.get(department)
    return mappedPosition === '기관장' || mappedPosition === '행정실장'
  })
  const fallbackLeadDepartment = (user.position === '기관장' || user.position === '행정실장') ? primaryDepartment : null
  const leadDepartments = explicitLeadDepartments.length
    ? explicitLeadDepartments
    : (fallbackLeadDepartment ? [fallbackLeadDepartment] : [])

  for (const department of selectedDepartments) {
    const mappedPosition = positionByDepartment.get(department)
    const explicitLead = ['기관장', '행정실장'].includes(mappedPosition) || leadDepartments.includes(department)
    const isLead = explicitLead || (
      !explicitLeadDepartments.length && department === fallbackLeadDepartment && ['기관장', '행정실장'].includes(mappedPosition)
    )
    base[department] = isLead ? '부장' : '없음'
  }

  return base
}

export function sanitizeDepartmentRoles(roles, _preferredLeadDepartment = null) {
  const next = { ...EMPTY_AFFILIATIONS, ...roles }
  for (const department of AFFILIATION_COLUMNS) {
    if (next[department] === '부서원') next[department] = '없음'
    if (next[department] !== '없음' && next[department] !== '부장') {
      next[department] = '없음'
    }
  }
  return next
}

export function derivePrimaryDepartment(currentDepartment, departments, roles, changedDepartment) {
  if (changedDepartment && roles[changedDepartment] !== '없음') return changedDepartment
  if (currentDepartment && departments.includes(currentDepartment)) return currentDepartment
  const headDepartment = departments.find((department) => roles[department] === '부장')
  if (headDepartment) return headDepartment
  return departments[0] ?? currentDepartment
}

export function derivePrimaryPosition(department, roles, fallback) {
  const role = department ? roles[department] ?? '없음' : '없음'
  const resolved = toInternalRole(role, department)
  if (resolved) return resolved

  const hasLeadDepartment = Object.values(roles ?? {}).includes('부장')
  if (!hasLeadDepartment) return '기안자'

  if (fallback === '교장') return '교장'
  if (fallback === '행정실장') return '행정실장'
  return '기관장'
}

export function getSelectedDepartmentRoles(roles) {
  return AFFILIATION_COLUMNS.filter((department) => roles[department] !== '없음')
}

export function getSelectedPositions(roles) {
  return AFFILIATION_COLUMNS.flatMap((department) => {
    const internalRole = toInternalRole(roles[department] ?? '없음', department)
    return internalRole ? [internalRole] : []
  })
}
