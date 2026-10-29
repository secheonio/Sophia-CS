import type { Position } from './types'

export type AffiliationRole = '없음' | '부장'

export const AFFILIATION_COLUMNS: readonly string[]
export const EMPTY_AFFILIATIONS: Record<string, AffiliationRole>

export function toInternalRole(value: string | AffiliationRole | null | undefined, department?: string | null): Position | null

export function buildDepartmentRoles(user: {
  departments?: string[]
  positions?: string[]
  department?: string
  position?: Position | string | null
}): Record<string, AffiliationRole>

export function sanitizeDepartmentRoles(
  roles: Record<string, AffiliationRole | string>,
  preferredLeadDepartment?: string | null,
): Record<string, AffiliationRole>

export function derivePrimaryDepartment(
  currentDepartment: string | null | undefined,
  departments: string[],
  roles: Record<string, AffiliationRole | string>,
  changedDepartment?: string,
): string | undefined

export function derivePrimaryPosition(
  department: string | null | undefined,
  roles: Record<string, AffiliationRole | string>,
  fallback: Position | string | null | undefined,
): Position

export function getSelectedDepartmentRoles(roles: Record<string, AffiliationRole | string>): string[]
export function getSelectedPositions(roles: Record<string, AffiliationRole | string>): Position[]
