const TOKEN_KEY = 'd11_token'

export function getToken(): string {
    return localStorage.getItem(TOKEN_KEY) || ''
}

export function api(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Authorization: 'Bearer ' + getToken() }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    return fetch(path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    })
}

export async function apiError(res: Response): Promise<string> {
    const err = await res.json().catch(() => ({})) as { error?: string }
    return err.error || `HTTP ${res.status}`
}
