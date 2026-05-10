import { createObject } from '../storage/objects.js';

export type ChatImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface ChatImageAttachmentInput {
  data: string;
  mediaType: ChatImageMediaType;
  name?: string;
  objectId?: string;
}

export interface StoredChatImageAttachment {
  objectId: string;
  objectType: 'image';
  name: string;
  filename: string;
  mimeType: ChatImageMediaType;
  sizeBytes: number;
  index: number;
  isDuplicate: boolean;
}

export interface ChatAttachmentMetadata {
  attachments: StoredChatImageAttachment[];
  imageObjectIds: string[];
}

const EXTENSIONS_BY_MIME: Record<ChatImageMediaType, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const IMAGE_MEDIA_TYPES = new Set<string>(Object.keys(EXTENSIONS_BY_MIME));

function sanitizeFilename(name: string | undefined, index: number, mediaType: ChatImageMediaType): string {
  const fallback = `chat-image-${index + 1}${EXTENSIONS_BY_MIME[mediaType]}`;
  if (!name) return fallback;

  const sanitized = name
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 180);

  if (!sanitized) return fallback;
  if (/\.[a-z0-9]+$/i.test(sanitized)) return sanitized;
  return `${sanitized}${EXTENSIONS_BY_MIME[mediaType]}`;
}

function decodeBase64Image(data: string): Buffer {
  const normalized = data.includes(',') ? data.split(',').pop() ?? '' : data;
  if (!normalized.trim()) {
    throw new Error('Image attachment is empty.');
  }
  return Buffer.from(normalized, 'base64');
}

export async function persistChatImageAttachments(input: {
  conversationId: string;
  message: string;
  images: ChatImageAttachmentInput[];
}): Promise<StoredChatImageAttachment[]> {
  const stored: StoredChatImageAttachment[] = [];

  for (const [index, image] of input.images.entries()) {
    if (!IMAGE_MEDIA_TYPES.has(image.mediaType)) {
      throw new Error(`Unsupported image attachment type: ${image.mediaType}`);
    }

    const data = decodeBase64Image(image.data);
    const filename = sanitizeFilename(image.name, index, image.mediaType);
    const name = image.name?.trim() || filename;

    const result = await createObject({
      name,
      filename,
      mimeType: image.mediaType,
      data,
      source: 'upload',
      description: `Chat image attachment from conversation ${input.conversationId}`,
      metadata: {
        attachmentType: 'chat_image',
        conversationId: input.conversationId,
        uploadIndex: index,
        originalName: image.name ?? null,
        messagePreview: input.message.slice(0, 500),
      },
      tags: ['chat-upload', 'image'],
    });

    stored.push({
      objectId: result.object.id,
      objectType: 'image',
      name: result.object.name,
      filename: result.object.filename,
      mimeType: result.object.mime_type as ChatImageMediaType,
      sizeBytes: result.object.size_bytes,
      index,
      isDuplicate: result.isDuplicate,
    });
  }

  return stored;
}

export function buildChatAttachmentMetadata(
  attachments: StoredChatImageAttachment[]
): Record<string, unknown> | null {
  if (attachments.length === 0) return null;
  return {
    attachments,
    imageObjectIds: attachments.map((attachment) => attachment.objectId),
  };
}

export function getChatImageAttachmentsFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): StoredChatImageAttachment[] {
  const rawAttachments = metadata?.['attachments'];
  if (!Array.isArray(rawAttachments)) return [];

  return rawAttachments.filter((attachment): attachment is StoredChatImageAttachment => {
    if (!attachment || typeof attachment !== 'object') return false;
    const candidate = attachment as Partial<StoredChatImageAttachment>;
    return (
      typeof candidate.objectId === 'string' &&
      candidate.objectType === 'image' &&
      typeof candidate.name === 'string' &&
      typeof candidate.mimeType === 'string'
    );
  });
}

export function formatChatImageAttachmentReferences(
  attachments: StoredChatImageAttachment[]
): string {
  if (attachments.length === 0) return '';

  const lines = attachments.map((attachment, index) => {
    const sizeKb = Math.max(1, Math.round(attachment.sizeBytes / 1024));
    return `- Image ${index + 1}: ${attachment.name} (objectId: ${attachment.objectId}, mimeType: ${attachment.mimeType}, size: ${sizeKb} KB)`;
  });

  return [
    '## Stored Image Attachments',
    'The user attached image(s) that are stored in object storage and can be inspected with analyze_image(objectId).',
    ...lines,
  ].join('\n');
}

export function appendChatAttachmentReferences(
  content: string,
  metadata: Record<string, unknown> | null | undefined
): string {
  const references = formatChatImageAttachmentReferences(
    getChatImageAttachmentsFromMetadata(metadata)
  );
  if (!references) return content;
  return `${content}\n\n${references}`;
}
