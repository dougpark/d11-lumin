import type { Attachment, DriveItem } from './types.ts'

function createAttachmentSlug(): string {
    return `att_${crypto.randomUUID().replace(/-/g, '').toLowerCase()}`
}

function sanitizeDisplayName(name: string): string {
    const cleaned = name
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .replace(/[\\/]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180)
    return cleaned || 'untitled'
}

function deriveFileCategory(contentType: string): string {
    const normalized = (contentType || '').toLowerCase()
    if (!normalized) return 'binary'
    if (normalized.startsWith('image/')) return 'image'
    if (normalized.startsWith('video/')) return 'video'
    if (normalized.startsWith('audio/')) return 'audio'
    if (normalized.includes('pdf')) return 'pdf'
    if (normalized.startsWith('text/') || normalized.includes('json') || normalized.includes('xml')) return 'text'
    return normalized.split('/')[0] || 'binary'
}

export type DriveItemWithAttachment = DriveItem & {
    attachment_id: number | null
    attachment_slug: string | null
    filename: string | null
    content_type: string | null
    size: number | null
}

export type DriveAttachmentShelfItem = Attachment & {
    linked_drive_item_id: number | null
}

export async function getDriveItemById(db: D1Database, userId: number, driveItemId: number): Promise<DriveItem | null> {
    const row = await db
        .prepare(
            `SELECT *
             FROM drive_items
             WHERE drive_item_id = ? AND user_id = ? AND deleted_at IS NULL
             LIMIT 1`,
        )
        .bind(driveItemId, userId)
        .first<DriveItem>()
    return row ?? null
}

async function isDescendantOf(
    db: D1Database,
    userId: number,
    ancestorId: number,
    possibleDescendantId: number,
): Promise<boolean> {
    const row = await db
        .prepare(
            `WITH RECURSIVE descendants(drive_item_id) AS (
                SELECT drive_item_id
                FROM drive_items
                WHERE user_id = ?
                  AND deleted_at IS NULL
                  AND parent_id = ?

                UNION ALL

                SELECT di.drive_item_id
                FROM drive_items di
                JOIN descendants d ON di.parent_id = d.drive_item_id
                WHERE di.user_id = ?
                  AND di.deleted_at IS NULL
            )
            SELECT drive_item_id
            FROM descendants
            WHERE drive_item_id = ?
            LIMIT 1`,
        )
        .bind(userId, ancestorId, userId, possibleDescendantId)
        .first<{ drive_item_id: number }>()

    return !!row
}

export async function listDriveChildren(db: D1Database, userId: number, parentId: number | null): Promise<DriveItemWithAttachment[]> {
    const parentClause = parentId === null ? 'di.parent_id IS NULL' : 'di.parent_id = ?'
    const stmt = db
        .prepare(
            `SELECT di.*, dl.attachment_id, a.attachment_slug, a.filename, a.content_type, a.size
             FROM drive_items di
             LEFT JOIN drive_list dl ON dl.drive_item_id = di.drive_item_id
             LEFT JOIN attachments a ON a.attachment_id = dl.attachment_id
             WHERE di.user_id = ?
               AND ${parentClause}
               AND di.deleted_at IS NULL
             ORDER BY CASE di.kind WHEN 'folder' THEN 0 ELSE 1 END, di.display_name COLLATE NOCASE ASC`,
        )

    const result = parentId === null
        ? await stmt.bind(userId).all<DriveItemWithAttachment>()
        : await stmt.bind(userId, parentId).all<DriveItemWithAttachment>()

    return result.results
}

export async function listAttachmentShelf(db: D1Database, userId: number): Promise<DriveAttachmentShelfItem[]> {
    const result = await db
        .prepare(
            `SELECT a.*, dl.drive_item_id AS linked_drive_item_id
             FROM attachments a
             LEFT JOIN drive_list dl ON dl.attachment_id = a.attachment_id
             WHERE a.owner_user_id = ?
               AND a.deleted_at IS NULL
             ORDER BY a.created_at DESC`,
        )
        .bind(userId)
        .all<DriveAttachmentShelfItem>()

    return result.results
}

export async function createDriveFolder(
    db: D1Database,
    userId: number,
    input: { parent_id: number | null; display_name: string },
): Promise<DriveItem> {
    if (input.parent_id !== null) {
        const parent = await getDriveItemById(db, userId, input.parent_id)
        if (!parent) throw new Error('Parent folder not found')
        if (parent.kind !== 'folder') throw new Error('Parent must be a folder')
    }

    const created = await db
        .prepare(
            `INSERT INTO drive_items (user_id, parent_id, kind, display_name)
             VALUES (?, ?, 'folder', ?)
             RETURNING *`,
        )
        .bind(userId, input.parent_id, sanitizeDisplayName(input.display_name))
        .first<DriveItem>()

    if (!created) throw new Error('Failed to create folder')
    return created
}

export async function createAttachmentForUser(
    db: D1Database,
    input: {
        user_id: number
        filename: string
        content_type: string
        size: number
        url: string
        file_last_modified: string | null
        file_etag: string | null
    },
): Promise<Attachment> {
    const filename = sanitizeDisplayName(input.filename)
    const category = deriveFileCategory(input.content_type)

    let created: Attachment | null = null
    let attempts = 0
    while (!created && attempts < 3) {
        attempts += 1
        const slug = createAttachmentSlug()
        try {
            created = await db
                .prepare(
                    `INSERT INTO attachments (
                        attachment_slug, owner_user_id, filename, content_type, size, url,
                        file_last_modified, file_category, file_etag
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    RETURNING *`,
                )
                .bind(
                    slug,
                    input.user_id,
                    filename,
                    input.content_type,
                    input.size,
                    input.url,
                    input.file_last_modified,
                    category,
                    input.file_etag,
                )
                .first<Attachment>()
        } catch (err) {
            const message = (err as Error).message || ''
            if (!message.includes('attachments.attachment_slug')) throw err
        }
    }

    if (!created) throw new Error('Failed to create attachment record')
    return created
}

export async function createDriveFile(
    db: D1Database,
    userId: number,
    input: { parent_id: number | null; display_name: string; attachment_id: number },
): Promise<DriveItemWithAttachment> {
    if (input.parent_id !== null) {
        const parent = await getDriveItemById(db, userId, input.parent_id)
        if (!parent) throw new Error('Parent folder not found')
        if (parent.kind !== 'folder') throw new Error('Parent must be a folder')
    }

    const created = await db
        .prepare(
            `INSERT INTO drive_items (user_id, parent_id, kind, display_name)
             VALUES (?, ?, 'file', ?)
             RETURNING *`,
        )
        .bind(userId, input.parent_id, sanitizeDisplayName(input.display_name))
        .first<DriveItem>()

    if (!created) throw new Error('Failed to create drive file')

    await db
        .prepare(
            `INSERT INTO drive_list (drive_item_id, attachment_id)
             VALUES (?, ?)`,
        )
        .bind(created.drive_item_id, input.attachment_id)
        .run()

    const row = await db
        .prepare(
            `SELECT di.*, dl.attachment_id, a.attachment_slug, a.filename, a.content_type, a.size
             FROM drive_items di
             JOIN drive_list dl ON dl.drive_item_id = di.drive_item_id
             JOIN attachments a ON a.attachment_id = dl.attachment_id
             WHERE di.drive_item_id = ? AND di.user_id = ?
             LIMIT 1`,
        )
        .bind(created.drive_item_id, userId)
        .first<DriveItemWithAttachment>()

    if (!row) throw new Error('Failed to load drive file')
    return row
}

export async function patchDriveItem(
    db: D1Database,
    userId: number,
    driveItemId: number,
    patch: { display_name?: string; parent_id?: number | null },
): Promise<DriveItem | null> {
    const current = await getDriveItemById(db, userId, driveItemId)
    if (!current) return null

    const set: string[] = []
    const bindings: Array<string | number | null> = []

    if (patch.display_name !== undefined) {
        set.push('display_name = ?')
        bindings.push(sanitizeDisplayName(patch.display_name))
    }

    if (patch.parent_id !== undefined) {
        if (patch.parent_id === driveItemId) throw new Error('Cannot move item into itself')

        if (patch.parent_id !== null) {
            const parent = await getDriveItemById(db, userId, patch.parent_id)
            if (!parent) throw new Error('Parent folder not found')
            if (parent.kind !== 'folder') throw new Error('Parent must be a folder')

            // Prevent cyclic trees when moving folders.
            if (current.kind === 'folder') {
                const movingIntoDescendant = await isDescendantOf(db, userId, driveItemId, patch.parent_id)
                if (movingIntoDescendant) throw new Error('Cannot move a folder into its own descendant')
            }
        }

        set.push('parent_id = ?')
        bindings.push(patch.parent_id)
    }

    if (!set.length) return current

    set.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')")

    const updated = await db
        .prepare(
            `UPDATE drive_items
             SET ${set.join(', ')}
             WHERE drive_item_id = ? AND user_id = ? AND deleted_at IS NULL
             RETURNING *`,
        )
        .bind(...bindings, driveItemId, userId)
        .first<DriveItem>()

    return updated ?? null
}

export async function softDeleteDriveItem(db: D1Database, userId: number, driveItemId: number): Promise<boolean> {
    const result = await db
        .prepare(
            `UPDATE drive_items
             SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
                 updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE drive_item_id = ? AND user_id = ? AND deleted_at IS NULL`,
        )
        .bind(driveItemId, userId)
        .run()

    return result.meta.changes > 0
}

export async function searchDriveItems(db: D1Database, userId: number, q: string): Promise<DriveItemWithAttachment[]> {
    const like = `%${q.toLowerCase()}%`
    const result = await db
        .prepare(
            `SELECT di.*, dl.attachment_id, a.attachment_slug, a.filename, a.content_type, a.size
             FROM drive_items di
             LEFT JOIN drive_list dl ON dl.drive_item_id = di.drive_item_id
             LEFT JOIN attachments a ON a.attachment_id = dl.attachment_id
             WHERE di.user_id = ?
               AND di.deleted_at IS NULL
               AND (LOWER(di.display_name) LIKE ? OR LOWER(COALESCE(a.filename, '')) LIKE ?)
             ORDER BY di.updated_at DESC
             LIMIT 120`,
        )
        .bind(userId, like, like)
        .all<DriveItemWithAttachment>()

    return result.results
}

export async function getDriveDownloadRecord(
    db: D1Database,
    userId: number,
    driveItemId: number,
): Promise<(DriveItemWithAttachment & { url: string }) | null> {
    const row = await db
        .prepare(
            `SELECT di.*, dl.attachment_id, a.attachment_slug, a.filename, a.content_type, a.size, a.url
             FROM drive_items di
             JOIN drive_list dl ON dl.drive_item_id = di.drive_item_id
             JOIN attachments a ON a.attachment_id = dl.attachment_id
             WHERE di.drive_item_id = ?
               AND di.user_id = ?
               AND di.deleted_at IS NULL
               AND a.deleted_at IS NULL
             LIMIT 1`,
        )
        .bind(driveItemId, userId)
        .first<DriveItemWithAttachment & { url: string }>()

    return row ?? null
}

export async function countAttachmentReferences(db: D1Database, attachmentId: number): Promise<number> {
    const [noteRefs, driveRefs] = await Promise.all([
        db.prepare('SELECT COUNT(*) AS cnt FROM attachment_list WHERE attachment_id = ?').bind(attachmentId).first<{ cnt: number }>(),
        db.prepare('SELECT COUNT(*) AS cnt FROM drive_list WHERE attachment_id = ?').bind(attachmentId).first<{ cnt: number }>(),
    ])
    return (noteRefs?.cnt ?? 0) + (driveRefs?.cnt ?? 0)
}
