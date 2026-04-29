// src/utils/header.ts
// Server-side header renderer — returns HTML string injected at request time.
// Each page HTML file contains a %%HEADER%% placeholder replaced by the route handler.

export interface HeaderConfig {
    /** Which page is active — controls active tab highlight and which nav links are hidden */
    activePage: 'app' | 'explore' | 'news'
    /** Displayed after the | separator in the header bar */
    pageTitle: string
    /** Placeholder text for the search input */
    searchPlaceholder: string
    /** Tooltip for the ⊞ nav-top button (page-defined navigateToTop() is called on click) */
    navTopTitle: string
    /** Show the blue + Add button (app only) */
    showAdd: boolean
    /** full = all app menu items; compact = explore/news subset (Dashboard, Analytics, Copy Link, Sign Out) */
    dropdownItems: 'full' | 'compact'
    /** Optional HTML injected between search and nav links (Mine/All pill, Feed/Topics pill, etc.) */
    navSlot?: string
    /** Whether to include the fixed mobile bottom nav (true for explore/news, false for app which has its own) */
    showMobileFooter?: boolean
    /** Start the header hidden — used for app.html where goTo('dashboard') controls visibility */
    initiallyHidden?: boolean
}

// ── Icon path fragments (reused across desktop and mobile nav) ──────────────

const ICON = {
    dashboard: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    explore: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
    news: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 12h6m-6-4h.01',
    bookmark: 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z',
    tag: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z',
    back: 'M15 19l-7-7 7-7',
    forward: 'M9 5l7 7-7 7',
    grid: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
    add: 'M12 4v16m8-8H4',
}

function svg(path: string, cls = 'w-4 h-4'): string {
    return `<svg class="${cls}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${path}"/></svg>`
}

// ── Dropdown contents ────────────────────────────────────────────────────────

const BTN = (onclick: string, label: string, cls = 'text-g-gray hover:bg-[#F3F4F6]') =>
    `<button onclick="${onclick}" class="w-full text-left px-4 py-2 text-sm ${cls} transition-colors">${label}</button>`
const LNKA = (href: string, label: string, extra = '') =>
    `<a href="${href}" ${extra}class="block w-full text-left px-4 py-2 text-sm text-g-gray hover:bg-[#F3F4F6] transition-colors">${label}</a>`

function desktopDropdown(type: 'full' | 'compact'): string {
    if (type === 'full') {
        return `
            ${BTN("window.location.href='/analytics'", 'Analytics')}
            ${BTN('openRenameTagModal(); toggleUserMenu()', 'Rename Tag')}
            ${BTN('doExportBookmarks(); toggleUserMenu()', 'Export Bookmarks')}
            ${BTN('openImportFile(); toggleUserMenu()', 'Import Bookmarks')}
            ${LNKA('/import/pinboard', 'Import from Pinboard')}
            ${LNKA('/import/browser', 'Import from Browser')}
            ${BTN('openTokenDrawer(); toggleUserMenu()', 'API Tokens')}
            ${BTN('copyLoginLink()', 'Copy Login Link')}
            ${LNKA('/admin', 'Admin', 'id="desktop-admin-link" ')}
            ${BTN('doLogout()', 'Sign Out', 'text-red-500 hover:bg-red-50')}`
    }
    // compact (explore / news)
    return `
            ${LNKA('/', 'Dashboard')}
            ${BTN("window.location.href='/analytics'", 'Analytics')}
            ${BTN('copyLoginLink()', 'Copy Login Link')}
            ${LNKA('/admin', 'Admin', 'id="desktop-admin-link" ')}
            ${BTN('doLogout()', 'Sign Out', 'text-red-500 hover:bg-red-50')}`
}

// ── Mobile bottom nav ────────────────────────────────────────────────────────

function mobileFooterNav(activePage: 'app' | 'explore' | 'news'): string {
    const active = 'flex-1 flex flex-col items-center py-3 gap-1 text-g-blue'
    const inactive = 'flex-1 flex flex-col items-center py-3 gap-1 text-g-gray hover:text-g-blue transition-colors'

    // On non-app pages, Bookmarks/Tags link to / (the app) rather than switching tabs
    const bookmarksItem = activePage === 'app'
        ? `<button onclick="switchMobileTab('bookmarks')" id="mobile-nav-bookmarks" class="${active}">
                ${svg(ICON.bookmark, 'w-5 h-5')}
                <span class="text-xs font-medium">Bookmarks</span>
            </button>`
        : `<a href="/" class="${inactive}">
                ${svg(ICON.bookmark, 'w-5 h-5')}
                <span class="text-xs font-medium">Bookmarks</span>
            </a>`

    const tagsItem = activePage === 'app'
        ? `<button onclick="switchMobileTab('tags')" id="mobile-nav-tags" class="${inactive}">
                ${svg(ICON.tag, 'w-5 h-5')}
                <span class="text-xs font-medium">Tags</span>
            </button>`
        : `<a href="/" class="${inactive}">
                ${svg(ICON.tag, 'w-5 h-5')}
                <span class="text-xs font-medium">Tags</span>
            </a>`

    return `
    <!-- Shared mobile bottom nav -->
    <nav id="shared-mobile-nav" class="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-g-border flex" style="padding-bottom:env(safe-area-inset-bottom)">
        ${bookmarksItem}
        ${tagsItem}
        <a href="/e" class="${activePage === 'explore' ? active : inactive}">
            ${svg(ICON.explore, 'w-5 h-5')}
            <span class="text-xs font-medium">Explore</span>
        </a>
        <a href="/n" class="${activePage === 'news' ? active : inactive}">
            ${svg(ICON.news, 'w-5 h-5')}
            <span class="text-xs font-medium">News</span>
        </a>
    </nav>
    <style>@media(max-width:639px){body{padding-bottom:calc(64px + env(safe-area-inset-bottom))}}</style>`
}

// ── Shared JS block ──────────────────────────────────────────────────────────

const SHARED_SCRIPT = `<script>
    // ── Shared header — history depth tracking ───────────────────────────────
    var historyDepth = 0
    var historyMaxDepth = 0

    function updateNavButtons() {
        var backBtn  = document.getElementById('nav-back')
        var fwdBtn   = document.getElementById('nav-forward')
        var enabled  = 'p-1.5 rounded-full text-g-gray hover:text-g-blue hover:bg-blue-50 transition-colors'
        var exit     = 'p-1.5 rounded-full text-g-gray opacity-50 hover:opacity-100 hover:text-g-blue hover:bg-blue-50 transition-colors'
        var disabled = 'p-1.5 rounded-full text-g-gray opacity-30 cursor-not-allowed transition-colors'
        if (backBtn) {
            backBtn.disabled = false
            backBtn.className = historyDepth === 0 ? exit : enabled
        }
        if (fwdBtn) {
            fwdBtn.disabled = historyDepth >= historyMaxDepth
            fwdBtn.className = historyDepth >= historyMaxDepth ? disabled : enabled
        }
    }

    // ── User auth & avatar population ────────────────────────────────────────
    function _headerSetUser(user) {
        if (!user) return
        var initials = ((user.full_name || user.slug_prefix || '?')).slice(0, 2).toUpperCase()
        var avatarEl = document.getElementById('user-avatar')
        if (avatarEl) avatarEl.textContent = initials
        var handleEl = document.getElementById('user-handle')
        if (handleEl) handleEl.textContent = user.slug_prefix || ''
        var nameEl = document.getElementById('menu-name')
        if (nameEl) nameEl.textContent = user.full_name || user.slug_prefix || ''
        var prefixEl = document.getElementById('menu-prefix')
        if (prefixEl) prefixEl.textContent = 'd11.me/l/' + (user.slug_prefix || '') + '/\u2026'
        var isAdmin = user.is_admin === 1
        var adminLink = document.getElementById('desktop-admin-link')
        if (adminLink) adminLink.classList.toggle('hidden', !isAdmin)
        var mobileAdminLink = document.getElementById('mobile-admin-link')
        if (mobileAdminLink) mobileAdminLink.classList.toggle('hidden', !isAdmin)
    }

    async function _headerInit() {
        if (window.__headerInitDone) return
        window.__headerInitDone = true
        try {
            var token = localStorage.getItem('d11_token')
            if (!token) return
            var res = await fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + token } })
            if (!res.ok) return
            var user = await res.json()
            window.__headerUser = user
            _headerSetUser(user)
        } catch (e) { /* silent — page may handle auth itself */ }
    }

    // ── Dropdown toggle ───────────────────────────────────────────────────────
    function toggleUserMenu() {
        var m = document.getElementById('user-menu')
        if (m) m.classList.toggle('hidden')
    }

    function toggleMobileUserMenu() {
        var m = document.getElementById('mobile-user-menu')
        if (m) m.classList.toggle('hidden')
    }

    // Close dropdowns on outside click
    document.addEventListener('click', function(e) {
        var menu = document.getElementById('user-menu')
        if (menu && !menu.classList.contains('hidden') &&
            !e.target.closest('[onclick="toggleUserMenu()"]') && !menu.contains(e.target)) {
            menu.classList.add('hidden')
        }
        var mMenu = document.getElementById('mobile-user-menu')
        if (mMenu && !mMenu.classList.contains('hidden') &&
            !e.target.closest('[onclick="toggleMobileUserMenu()"]') && !mMenu.contains(e.target)) {
            mMenu.classList.add('hidden')
        }
    })

    // ── Shared auth actions (overridden by app.html's own definitions) ────────
    function copyLoginLink() {
        var token = localStorage.getItem('d11_token')
        if (!token) return
        navigator.clipboard.writeText(location.origin + '/?token=' + encodeURIComponent(token))
        if (typeof toast === 'function') toast('Login link copied \u2014 bookmark it in your browser!')
        var m = document.getElementById('user-menu')
        if (m) m.classList.add('hidden')
        var mm = document.getElementById('mobile-user-menu')
        if (mm) mm.classList.add('hidden')
    }

    function doLogout() {
        localStorage.removeItem('d11_token')
        document.cookie = 'd11_auth=; path=/; SameSite=Lax; Secure; max-age=0'
        location.href = '/'
    }

    _headerInit()
<\/script>`

// ── Main export ──────────────────────────────────────────────────────────────

export function renderHeader(config: HeaderConfig): string {
    const {
        activePage,
        pageTitle,
        searchPlaceholder,
        navTopTitle,
        showAdd,
        dropdownItems,
        navSlot = '',
        showMobileFooter = true,
        initiallyHidden = false,
    } = config

    const hiddenCls = initiallyHidden ? ' hidden' : ''

    // Nav links — omit the link for the current page
    const exploreLink = activePage !== 'explore'
        ? `<a href="/e" class="hidden sm:flex items-center gap-1.5 text-xs text-g-gray hover:text-g-blue transition-colors flex-shrink-0">
                ${svg(ICON.explore, 'w-3.5 h-3.5')} Explore
            </a>` : ''
    const newsLink = activePage !== 'news'
        ? `<a href="/n" class="hidden sm:flex items-center gap-1.5 text-xs text-g-gray hover:text-g-blue transition-colors flex-shrink-0">
                ${svg(ICON.news, 'w-3.5 h-3.5')} News
            </a>` : ''
    const dashLink = activePage !== 'app'
        ? `<a href="/" class="hidden sm:flex items-center gap-1.5 text-xs text-g-gray hover:text-g-blue transition-colors flex-shrink-0">
                ${svg(ICON.dashboard, 'w-3.5 h-3.5')} Dashboard
            </a>` : ''

    const addButton = showAdd
        ? `<button onclick="openAddModal()" class="bg-g-blue text-white text-sm font-semibold px-4 py-2 rounded-full hover:bg-blue-600 transition-all flex items-center gap-1.5 flex-shrink-0">
                ${svg(ICON.add, 'w-4 h-4')} Add
            </button>` : ''

    return `<!-- %%HEADER%% — rendered by renderHeader() -->
    <header id="shared-header" class="sticky top-0 z-50${hiddenCls} bg-white/90 backdrop-blur-md border-b border-g-border">
        <div class="max-w-7xl mx-auto px-6 h-14 flex items-center gap-3">
            <a href="/" class="flex-shrink-0">
                <img src="/lumin_navbar_650.png" alt="Lumin" class="h-8 w-auto">
            </a>

            <!-- Back / Forward / Top -->
            <div class="flex items-center gap-0.5 flex-shrink-0">
                <button id="nav-back" onclick="history.back()" title="Back"
                    class="p-1.5 rounded-full text-g-gray opacity-50 hover:opacity-100 hover:text-g-blue hover:bg-blue-50 transition-colors">
                    ${svg(ICON.back)}
                </button>
                <button id="nav-forward" onclick="history.forward()" title="Forward" disabled
                    class="p-1.5 rounded-full text-g-gray opacity-30 cursor-not-allowed transition-colors">
                    ${svg(ICON.forward)}
                </button>
                <button id="nav-top" onclick="navigateToTop()" title="${navTopTitle}"
                    class="hidden sm:block p-1.5 rounded-full text-g-gray hover:text-g-blue hover:bg-blue-50 transition-colors">
                    ${svg(ICON.grid)}
                </button>
            </div>

            <span class="text-g-border select-none hidden sm:block">|</span>
            <h1 id="page-title" class="hidden sm:block text-sm font-semibold text-g-black flex-shrink-0 capitalize">${pageTitle}</h1>

            <!-- Search -->
            <div class="flex-1 relative min-w-0">
                <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-g-gray pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0"/>
                </svg>
                <input id="search-input" type="search" autocomplete="off"
                    class="w-full pl-8 pr-4 py-1.5 text-sm border border-g-border rounded-full focus:outline-none focus:border-g-blue bg-[#FAFAFA] transition-colors"
                    placeholder="${searchPlaceholder}" oninput="headerSearch(this.value)">
            </div>

            ${navSlot}
            ${exploreLink}
            ${newsLink}
            ${dashLink}
            ${addButton}

            <!-- User avatar + dropdown -->
            <div class="relative flex-shrink-0">
                <button onclick="toggleUserMenu()" class="flex items-center gap-2 text-sm text-g-gray hover:text-g-black transition-colors">
                    <div id="user-avatar" class="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-g-blue font-bold text-xs">?</div>
                    <span id="user-handle" class="hidden sm:block text-xs font-semibold text-g-gray max-w-[96px] truncate"></span>
                </button>
                <div id="user-menu" class="hidden absolute right-0 top-10 bg-white border border-g-border rounded-[12px] shadow-lg w-52 py-1 z-50">
                    <div class="px-4 py-2 border-b border-g-border">
                        <p id="menu-name" class="text-xs font-semibold text-g-black truncate">—</p>
                        <p id="menu-prefix" class="text-xs text-g-gray truncate">—</p>
                    </div>
                    ${desktopDropdown(dropdownItems)}
                </div>
            </div>
        </div>
    </header>
${showMobileFooter ? mobileFooterNav(activePage) : ''}
${SHARED_SCRIPT}`
}
