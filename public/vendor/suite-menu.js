(function () {
    var instances = []
    var outsideClickBound = false

    var ITEMS = [
        { key: 'dashboard', href: '/', label: 'Bookmarks' },
        { key: 'news', href: '/n', label: 'News' },
        { key: 'explore', href: '/e', label: 'Explore' },
        { key: 'chat', href: '/chat', label: 'Chat' },
        { key: 'notes', href: '/notes', label: 'Notes' },
        { key: 'health', href: '/health', label: 'Health' },
        { key: 'drive', href: '/drive', label: 'Drive' },
        { key: 'settings', href: '/settings', label: 'Settings' },
    ]

    var ADMIN_ITEMS = [
        { key: 'admin', href: '/admin', label: 'Admin' },
        { key: 'analytics', href: '/analytics', label: 'Analytics' },
    ]

    function classesForMode(mode) {
        if (mode === 'accent') {
            return {
                base: 'text-[#1a1a2e] hover:bg-muted',
                active: 'bg-primary/10 text-primary font-semibold',
            }
        }
        return {
            base: 'text-g-gray hover:bg-[#F3F4F6]',
            active: 'bg-blue-50 text-g-blue font-semibold',
        }
    }

    function linkHtml(item, activePage, mode, adminOnly) {
        var classes = classesForMode(mode)
        var stateClass = item.key === activePage ? classes.active : classes.base
        var adminAttrs = adminOnly
            ? ' data-href="' + item.href + '" aria-disabled="true" class="suite-admin-only flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg ' + stateClass + ' opacity-40 cursor-not-allowed pointer-events-none"'
            : ' class="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg ' + stateClass + ' transition-colors"'

        var href = adminOnly ? '#' : item.href
        return '<a href="' + href + '"' + adminAttrs + '>' + item.label + '</a>'
    }

    function renderMenuContent(activePage, mode) {
        var html = '<p class="px-3 py-1 text-[11px] uppercase tracking-wide text-muted-fg">Suite</p>'
        if (mode === 'light') {
            html = '<p class="px-3 py-1 text-[11px] uppercase tracking-wide text-g-gray">Suite</p>'
        }

        ITEMS.forEach(function (item) {
            html += linkHtml(item, activePage, mode, false)
        })

        html += '<div class="my-1 border-t border-border"></div>'
        if (mode === 'light') {
            html = html.replace('border-border', 'border-g-border')
        }

        ADMIN_ITEMS.forEach(function (item) {
            html += linkHtml(item, activePage, mode, true)
        })

        return html
    }

    function closeAll() {
        instances.forEach(function (instance) {
            instance.menu.classList.add('hidden')
            instance.button.setAttribute('aria-expanded', 'false')
        })
    }

    function bindOutsideClick() {
        if (outsideClickBound) return
        outsideClickBound = true
        document.addEventListener('click', function (event) {
            var target = event.target
            if (!(target instanceof Element)) return

            var insideAny = instances.some(function (instance) {
                return instance.menu.contains(target) || instance.button.contains(target)
            })
            if (!insideAny) closeAll()
        })
    }

    function initMenu(config) {
        var button = document.getElementById(config.buttonId)
        var menu = document.getElementById(config.menuId)
        if (!button || !menu) return null

        menu.innerHTML = renderMenuContent(config.activePage, config.mode || 'light')

        var instance = { button: button, menu: menu }
        instances.push(instance)

        button.addEventListener('click', function (event) {
            event.stopPropagation()
            var willOpen = menu.classList.contains('hidden')
            closeAll()
            if (willOpen) {
                menu.classList.remove('hidden')
                button.setAttribute('aria-expanded', 'true')
            }
        })

        bindOutsideClick()
        return instance
    }

    function setAdminAccess(isAdmin) {
        document.querySelectorAll('.suite-admin-only').forEach(function (link) {
            if (!(link instanceof HTMLAnchorElement)) return
            if (isAdmin) {
                link.classList.remove('opacity-40', 'cursor-not-allowed', 'pointer-events-none')
                link.removeAttribute('aria-disabled')
                var target = link.getAttribute('data-href')
                if (target) link.setAttribute('href', target)
                return
            }
            link.classList.add('opacity-40', 'cursor-not-allowed', 'pointer-events-none')
            link.setAttribute('aria-disabled', 'true')
            link.setAttribute('href', '#')
        })
    }

    window.LuminSuiteMenu = {
        initMenu: initMenu,
        setAdminAccess: setAdminAccess,
        closeAll: closeAll,
        getItems: function () { return ITEMS.slice() },
        getAdminItems: function () { return ADMIN_ITEMS.slice() },
    }
})()
