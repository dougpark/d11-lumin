import { api, getToken } from './api.ts'

export type CurrentUser = {
    id: number
    full_name?: string | null
    slug_prefix?: string | null
    is_admin: 0 | 1
}

type SuiteMenu = {
    initMenu(opts: { buttonId: string; menuId: string; activePage: string; mode: 'light' | 'dark' }): void
    setAdminAccess(isAdmin: boolean): void
}

declare global {
    interface Window { LuminSuiteMenu: SuiteMenu }
}

/** Loads the signed-in user, or redirects to the login page and returns null. */
export async function requireUser(): Promise<CurrentUser | null> {
    if (!getToken()) {
        location.href = '/'
        return null
    }
    const res = await api('GET', '/api/auth/me')
    if (!res.ok) {
        location.href = '/'
        return null
    }
    return res.json() as Promise<CurrentUser>
}

export function initSuiteMenu(activePage: string): void {
    window.LuminSuiteMenu.initMenu({ buttonId: 'btn-suite-menu', menuId: 'suite-menu', activePage, mode: 'light' })
}

export function applyUserToHeader(user: CurrentUser): void {
    const el = document.querySelector('#header-user-name')
    if (el) el.textContent = user.full_name || user.slug_prefix || 'User'
    window.LuminSuiteMenu.setAdminAccess(user.is_admin === 1)
}
