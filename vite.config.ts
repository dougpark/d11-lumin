import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Pages migrated off the Tailwind CDN. Each entry is built to dist/<name>.html.
const pages = {
    health: r('./web/health.html'),
    food: r('./web/food.html'),
}

export default defineConfig({
    root: r('./web'),
    publicDir: r('./public'),
    plugins: [tailwindcss()],
    build: {
        outDir: r('./dist'),
        emptyOutDir: true,
        rolldownOptions: { input: pages },
    },
    server: {
        proxy: { '/api': 'http://localhost:8787' },
    },
})
