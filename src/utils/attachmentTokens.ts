const DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS = 300

type SignedTokenResult = {
    token: string
    exp: number
}

export function getTokenSecret(secret: string | undefined | null): string | null {
    if (typeof secret !== 'string') return null
    const normalized = secret.trim()
    return normalized.length > 0 ? normalized : null
}

function encodeBase64Url(bytes: Uint8Array): string {
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string): Uint8Array {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
    return diff === 0
}

async function signToken(secret: string, payload: string): Promise<string> {
    const normalizedSecret = getTokenSecret(secret)
    if (!normalizedSecret) throw new Error('TOKEN_SECRET is not configured')

    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(normalizedSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
    return encodeBase64Url(new Uint8Array(sig))
}

export async function createDriveDownloadToken(
    secret: string,
    userId: number,
    driveItemId: number,
    ttlSeconds = DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS,
): Promise<SignedTokenResult> {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds
    const payload = `${userId}.${driveItemId}.${exp}`
    const signature = await signToken(secret, payload)
    return { token: `${payload}.${signature}`, exp }
}

export async function verifyDriveDownloadToken(
    secret: string,
    token: string,
): Promise<{ userId: number; driveItemId: number; exp: number } | null> {
    const parts = token.split('.')
    if (parts.length !== 4) return null
    const [userPart, itemPart, expPart, signaturePart] = parts

    const userId = parseInt(userPart, 10)
    const driveItemId = parseInt(itemPart, 10)
    const exp = parseInt(expPart, 10)
    if (!Number.isInteger(userId) || !Number.isInteger(driveItemId) || !Number.isInteger(exp)) return null
    if (exp < Math.floor(Date.now() / 1000)) return null

    const payload = `${userId}.${driveItemId}.${exp}`
    const expectedSig = await signToken(secret, payload)
    const expectedBytes = decodeBase64Url(expectedSig)
    const actualBytes = decodeBase64Url(signaturePart)
    if (!timingSafeEqual(expectedBytes, actualBytes)) return null

    return { userId, driveItemId, exp }
}

export async function createAttachmentDownloadToken(
    secret: string,
    ownerUserId: number,
    attachmentSlug: string,
    ttlSeconds = DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS,
): Promise<SignedTokenResult> {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds
    const payload = `${ownerUserId}.${attachmentSlug}.${exp}`
    const signature = await signToken(secret, payload)
    return { token: `${payload}.${signature}`, exp }
}

export async function verifyAttachmentDownloadToken(
    secret: string,
    token: string,
): Promise<{ ownerUserId: number; attachmentSlug: string; exp: number } | null> {
    const parts = token.split('.')
    if (parts.length !== 4) return null
    const [ownerUserPart, slugPart, expPart, signaturePart] = parts

    const ownerUserId = parseInt(ownerUserPart, 10)
    const exp = parseInt(expPart, 10)
    if (!Number.isInteger(ownerUserId) || !Number.isInteger(exp)) return null
    if (!slugPart || slugPart.includes('.')) return null
    if (exp < Math.floor(Date.now() / 1000)) return null

    const payload = `${ownerUserId}.${slugPart}.${exp}`
    const expectedSig = await signToken(secret, payload)
    const expectedBytes = decodeBase64Url(expectedSig)
    const actualBytes = decodeBase64Url(signaturePart)
    if (!timingSafeEqual(expectedBytes, actualBytes)) return null

    return { ownerUserId, attachmentSlug: slugPart, exp }
}
