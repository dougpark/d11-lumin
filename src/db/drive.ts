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
    note_ref_count?: number | null
    is_attached_to_note?: number | null
    tag_list?: string | null
    ai_tags?: string | null
    summary?: string | null
    modified_at?: string | null
}

export type DriveAttachmentShelfItem = Attachment & {
    linked_drive_item_id: number | null
    note_ref_count: number
}

export type DriveAttachmentNoteRef = {
    note_id: number
    channel_id: number
    channel_name: string | null
    last_modified_at: string
    content_preview: string
}

export type DriveAttachmentInfo = {
    attachment_id: number
    attachment_slug: string
    filename: string
    content_type: string
    size: number
    file_last_modified: string | null
    file_category: string | null
    file_etag: string | null
    created_at: string
    ai_processed_at: string | null
    summary: string
    ai_summary: string
    tag_list: string
    ai_tags: string
    note_ref_count: number
    drive_item_id: number | null
    drive_display_name: string | null
    notes: DriveAttachmentNoteRef[]
}

type DriveAttachmentInspectorPatch = {
    filename?: string
    summary?: string
    tag_list?: string[]
}

function normalizeInspectorFilename(value: string | undefined): string | undefined {
    if (value === undefined) return undefined
    return sanitizeDisplayName(String(value))
}

function normalizeInspectorSummary(value: string | undefined): string | undefined {
    if (value === undefined) return undefined
    return String(value).trim().slice(0, 4000)
}

function normalizeInspectorTagList(tags: string[] | undefined): string[] | undefined {
    if (tags === undefined) return undefined
    const seen = new Set<string>()
    const normalized: string[] = []
    for (const rawTag of tags) {
        if (typeof rawTag !== 'string') continue
        const tag = rawTag.trim().replace(/\s+/g, ' ').slice(0, 64)
        if (!tag) continue
        const key = tag.toLocaleLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        normalized.push(tag)
        if (normalized.length >= 50) break
    }
    return normalized
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
                          , COALESCE(ar.note_ref_count, 0) AS note_ref_count
                          , CASE WHEN COALESCE(ar.note_ref_count, 0) > 0 THEN 1 ELSE 0 END AS is_attached_to_note
             FROM drive_items di
             LEFT JOIN drive_list dl ON dl.drive_item_id = di.drive_item_id
             LEFT JOIN attachments a ON a.attachment_id = dl.attachment_id
                 LEFT JOIN (
                     SELECT attachment_id, COUNT(*) AS note_ref_count
                     FROM attachment_list
                     GROUP BY attachment_id
                 ) ar ON ar.attachment_id = dl.attachment_id
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
            `SELECT a.*, dl.drive_item_id AS linked_drive_item_id,
                                        COALESCE(ar.note_ref_count, 0) AS note_ref_count
             FROM attachments a
             LEFT JOIN drive_list dl ON dl.attachment_id = a.attachment_id
                         LEFT JOIN (
                                SELECT attachment_id, COUNT(*) AS note_ref_count
                                FROM attachment_list
                                GROUP BY attachment_id
                         ) ar ON ar.attachment_id = a.attachment_id
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
            `SELECT di.*, dl.attachment_id, a.attachment_slug, a.filename, a.content_type, a.size,
                          a.tag_list, a.summary, a.ai_tags, a.ai_summary,
                          COALESCE(ar.note_ref_count, 0) AS note_ref_count,
                          CASE WHEN COALESCE(ar.note_ref_count, 0) > 0 THEN 1 ELSE 0 END AS is_attached_to_note
             FROM drive_items di
             LEFT JOIN drive_list dl ON dl.drive_item_id = di.drive_item_id
             LEFT JOIN attachments a ON a.attachment_id = dl.attachment_id
                 LEFT JOIN (
                     SELECT attachment_id, COUNT(*) AS note_ref_count
                     FROM attachment_list
                     GROUP BY attachment_id
                 ) ar ON ar.attachment_id = dl.attachment_id
             WHERE di.user_id = ?
               AND di.deleted_at IS NULL
                AND (
                    LOWER(di.display_name) LIKE ?
                    OR LOWER(COALESCE(a.filename, '')) LIKE ?
                    OR LOWER(COALESCE(a.tag_list, '')) LIKE ?
                    OR LOWER(COALESCE(a.summary, '')) LIKE ?
                    OR LOWER(COALESCE(a.ai_tags, '')) LIKE ?
                    OR LOWER(COALESCE(a.ai_summary, '')) LIKE ?
                )
             ORDER BY di.updated_at DESC
             LIMIT 120`,
        )
        .bind(userId, like, like, like, like, like, like)
        .all<DriveItemWithAttachment>()

    return result.results
}

export async function listDriveAttachPickerItems(
    db: D1Database,
    userId: number,
    q: string,
    limit: number,
): Promise<DriveItemWithAttachment[]> {
    const normalizedQuery = q.trim().toLowerCase()
    const useSearch = normalizedQuery.length > 0
    const like = `%${normalizedQuery}%`
    const stmt = db
        .prepare(
            `SELECT
                di.*,
                dl.attachment_id,
                a.attachment_slug,
                a.filename,
                a.content_type,
                a.size,
                     COALESCE(ar.note_ref_count, 0) AS note_ref_count,
                     CASE WHEN COALESCE(ar.note_ref_count, 0) > 0 THEN 1 ELSE 0 END AS is_attached_to_note,
                a.tag_list,
                a.ai_tags,
                a.summary,
                COALESCE(di.updated_at, a.created_at, a.file_last_modified, di.created_at) AS modified_at
             FROM drive_items di
             JOIN drive_list dl ON dl.drive_item_id = di.drive_item_id
             JOIN attachments a ON a.attachment_id = dl.attachment_id
                 LEFT JOIN (
                     SELECT attachment_id, COUNT(*) AS note_ref_count
                     FROM attachment_list
                     GROUP BY attachment_id
                 ) ar ON ar.attachment_id = dl.attachment_id
             WHERE di.user_id = ?
               AND di.deleted_at IS NULL
               AND di.kind = 'file'
               AND a.deleted_at IS NULL
               ${useSearch ? `AND (
                    LOWER(di.display_name) LIKE ?
                    OR LOWER(COALESCE(a.filename, '')) LIKE ?
                    OR LOWER(COALESCE(a.tag_list, '')) LIKE ?
                    OR LOWER(COALESCE(a.ai_tags, '')) LIKE ?
                )` : ''}
             ORDER BY CASE WHEN a.file_last_modified IS NOT NULL THEN a.file_last_modified ELSE di.updated_at END DESC, di.display_name COLLATE NOCASE ASC
             LIMIT ?`,
        )

    const result = useSearch
        ? await stmt.bind(userId, like, like, like, like, limit).all<DriveItemWithAttachment>()
        : await stmt.bind(userId, limit).all<DriveItemWithAttachment>()

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

async function listAttachmentNoteRefs(
    db: D1Database,
    userId: number,
    attachmentId: number,
): Promise<DriveAttachmentNoteRef[]> {
    const rows = await db
        .prepare(
            `SELECT
                n.note_id,
                n.channel_id,
                nc.name AS channel_name,
                n.last_modified_at,
                SUBSTR(TRIM(REPLACE(REPLACE(n.content, CHAR(10), ' '), CHAR(13), ' ')), 1, 180) AS content_preview
             FROM attachment_list al
             JOIN notes n ON n.note_id = al.note_id
             LEFT JOIN note_channels nc ON nc.id = n.channel_id AND nc.user_id = n.user_id
             WHERE al.attachment_id = ?
               AND n.user_id = ?
             ORDER BY n.last_modified_at DESC, n.note_id DESC`,
        )
        .bind(attachmentId, userId)
        .all<DriveAttachmentNoteRef>()

    return rows.results
}

export async function getDriveAttachmentInfoByDriveItemId(
    db: D1Database,
    userId: number,
    driveItemId: number,
): Promise<DriveAttachmentInfo | null> {
    const row = await db
        .prepare(
            `SELECT
                a.attachment_id,
                a.attachment_slug,
                a.filename,
                a.content_type,
                a.size,
                a.file_last_modified,
                a.file_category,
                a.file_etag,
                a.created_at,
                a.ai_processed_at,
                a.summary,
                a.ai_summary,
                a.tag_list,
                a.ai_tags,
                COALESCE(ar.note_ref_count, 0) AS note_ref_count,
                di.drive_item_id,
                di.display_name AS drive_display_name
             FROM drive_items di
             JOIN drive_list dl ON dl.drive_item_id = di.drive_item_id
             JOIN attachments a ON a.attachment_id = dl.attachment_id
             LEFT JOIN (
                SELECT attachment_id, COUNT(*) AS note_ref_count
                FROM attachment_list
                GROUP BY attachment_id
             ) ar ON ar.attachment_id = a.attachment_id
             WHERE di.drive_item_id = ?
               AND di.user_id = ?
               AND di.deleted_at IS NULL
               AND a.deleted_at IS NULL
             LIMIT 1`,
        )
        .bind(driveItemId, userId)
        .first<Omit<DriveAttachmentInfo, 'notes'>>()

    if (!row) return null
    const notes = await listAttachmentNoteRefs(db, userId, row.attachment_id)
    return { ...row, notes }
}

export async function getDriveAttachmentInfoByAttachmentId(
    db: D1Database,
    userId: number,
    attachmentId: number,
): Promise<DriveAttachmentInfo | null> {
    const row = await db
        .prepare(
            `SELECT
                a.attachment_id,
                a.attachment_slug,
                a.filename,
                a.content_type,
                a.size,
                a.file_last_modified,
                a.file_category,
                a.file_etag,
                a.created_at,
                a.ai_processed_at,
                a.summary,
                a.ai_summary,
                a.tag_list,
                a.ai_tags,
                COALESCE(ar.note_ref_count, 0) AS note_ref_count,
                di.drive_item_id,
                di.display_name AS drive_display_name
             FROM attachments a
             LEFT JOIN drive_list dl ON dl.attachment_id = a.attachment_id
             LEFT JOIN drive_items di ON di.drive_item_id = dl.drive_item_id AND di.user_id = a.owner_user_id AND di.deleted_at IS NULL
             LEFT JOIN (
                SELECT attachment_id, COUNT(*) AS note_ref_count
                FROM attachment_list
                GROUP BY attachment_id
             ) ar ON ar.attachment_id = a.attachment_id
             WHERE a.attachment_id = ?
               AND a.owner_user_id = ?
               AND a.deleted_at IS NULL
             ORDER BY di.updated_at DESC
             LIMIT 1`,
        )
        .bind(attachmentId, userId)
        .first<Omit<DriveAttachmentInfo, 'notes'>>()

    if (!row) return null
    const notes = await listAttachmentNoteRefs(db, userId, row.attachment_id)
    return { ...row, notes }
}

async function updateDriveAttachmentInspectorByAttachmentIdInternal(
    db: D1Database,
    userId: number,
    attachmentId: number,
    patch: DriveAttachmentInspectorPatch,
): Promise<DriveAttachmentInfo | null> {
    const setClauses: string[] = []
    const bindings: Array<string | number> = []

    const filename = normalizeInspectorFilename(patch.filename)
    if (filename !== undefined) {
        setClauses.push('filename = ?')
        bindings.push(filename)
    }

    const summary = normalizeInspectorSummary(patch.summary)
    if (summary !== undefined) {
        setClauses.push('summary = ?')
        bindings.push(summary)
    }

    const tagList = normalizeInspectorTagList(patch.tag_list)
    if (tagList !== undefined) {
        setClauses.push('tag_list = ?')
        bindings.push(JSON.stringify(tagList))
    }

    if (!setClauses.length) {
        return getDriveAttachmentInfoByAttachmentId(db, userId, attachmentId)
    }

    const updated = await db
        .prepare(
            `UPDATE attachments
             SET ${setClauses.join(', ')}
             WHERE attachment_id = ?
               AND owner_user_id = ?
               AND deleted_at IS NULL
             RETURNING attachment_id`,
        )
        .bind(...bindings, attachmentId, userId)
        .first<{ attachment_id: number }>()

    if (!updated) return null

    if (filename !== undefined) {
        await db
            .prepare(
                `UPDATE drive_items
                 SET display_name = ?,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                 WHERE user_id = ?
                   AND deleted_at IS NULL
                   AND drive_item_id IN (
                        SELECT drive_item_id
                        FROM drive_list
                        WHERE attachment_id = ?
                   )`,
            )
            .bind(filename, userId, attachmentId)
            .run()
    }

    return getDriveAttachmentInfoByAttachmentId(db, userId, attachmentId)
}

export async function updateDriveAttachmentInspectorByDriveItemId(
    db: D1Database,
    userId: number,
    driveItemId: number,
    patch: DriveAttachmentInspectorPatch,
): Promise<DriveAttachmentInfo | null> {
    const link = await db
        .prepare(
            `SELECT a.attachment_id
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
        .first<{ attachment_id: number }>()

    if (!link) return null
    return updateDriveAttachmentInspectorByAttachmentIdInternal(db, userId, link.attachment_id, patch)
}

export async function updateDriveAttachmentInspectorByAttachmentId(
    db: D1Database,
    userId: number,
    attachmentId: number,
    patch: DriveAttachmentInspectorPatch,
): Promise<DriveAttachmentInfo | null> {
    return updateDriveAttachmentInspectorByAttachmentIdInternal(db, userId, attachmentId, patch)
}

export async function countAttachmentReferences(db: D1Database, attachmentId: number): Promise<number> {
    const [noteRefs, driveRefs] = await Promise.all([
        db.prepare('SELECT COUNT(*) AS cnt FROM attachment_list WHERE attachment_id = ?').bind(attachmentId).first<{ cnt: number }>(),
        db.prepare('SELECT COUNT(*) AS cnt FROM drive_list WHERE attachment_id = ?').bind(attachmentId).first<{ cnt: number }>(),
    ])
    return (noteRefs?.cnt ?? 0) + (driveRefs?.cnt ?? 0)
}
