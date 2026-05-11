/**
 * Dealer Display Tracking Service
 *
 * Manages dealer profiles, display obligations, and CSV imports.
 * Account number is the durable identity backbone for dealers.
 */

import { pool } from '../../db/pool.js';
import { generateEmbedding } from '../../providers/embeddings.js';

// =============================================================================
// TYPES
// =============================================================================

export interface Dealer {
  id: string;
  account_number: string;
  name: string;
  trade_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  rep_name: string | null;
  has_responsive: boolean;
  has_lauzon: boolean;
  manufacturer_code: string | null;
  category: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

export interface DealerImport {
  id: string;
  filename: string | null;
  source: string;
  total_rows: number;
  dealers_created: number;
  dealers_updated: number;
  work_items_created: number;
  work_items_updated: number;
  errors: number;
  error_details: string[];
  status: string;
  imported_at: Date;
  completed_at: Date | null;
}

export interface DealerDisplayWork {
  id: string;
  dealer_id: string;
  import_id: string | null;
  manufacturer: string;
  display_type: string;
  quantity: number;
  sales_amount: number | null;
  sales_period: string | null;
  status: string;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

export interface CsvRow {
  rep?: string;
  account?: string;
  ship_to?: string;
  name?: string;
  trade_name?: string;
  t_a?: string;              // Alternative: "T/A" header normalizes to "t_a"
  r?: string;
  l?: string;
  code?: string;
  // Responsive displays
  respons_dsp?: string;
  resp_showcase?: string;
  resp_triple_tower?: string;
  resp_two_tower?: string;
  resp_elite_conv?: string;
  resp_sales_2025?: string;
  // Lauzon displays
  lauzon_dsp?: string;
  lzn_pure_series?: string;
  lzn_mini_rev?: string;
  lzn_desig_influ?: string;
  lzn_studio?: string;
  expert_by_lzn?: string;
  lzn_coll_studio?: string;
  lauzon_sales_2025?: string;
  // Location
  address?: string;
  city?: string;
  state?: string;
  st?: string;               // Alternative: "St" header normalizes to "st"
  zip?: string;
}

export interface ImportOptions {
  filename?: string;
  source?: string;
  onProgress?: (current: number, total: number, dealerName: string) => void;
}

export interface ImportResult {
  import_id: string;
  total_rows: number;
  dealers_created: number;
  dealers_updated: number;
  work_items_created: number;
  work_items_updated: number;
  errors: number;
  error_details: string[];
}

export interface DealerQuery {
  manufacturer?: 'responsive' | 'lauzon' | 'both';
  rep_name?: string;
  city?: string;
  state?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface WorkQuery {
  dealer_id?: string;
  manufacturer?: string;
  display_type?: string;
  status?: string;
  min_quantity?: number;
  limit?: number;
  offset?: number;
}

// =============================================================================
// CSV PARSING
// =============================================================================

/**
 * Parse CSV content into rows
 */
export function parseCsv(content: string): CsvRow[] {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];

  // Parse header (handle BOM)
  const headerLine = lines[0]!.replace(/^\uFEFF/, '');
  const headers = parseCSVLine(headerLine).map(h => normalizeHeader(h));

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: Record<string, string> = {};

    for (let j = 0; j < headers.length && j < values.length; j++) {
      const header = headers[j];
      if (header) {
        row[header] = values[j]?.trim() || '';
      }
    }

    // Skip totals row or empty account rows
    if (!row.account || row.account.toLowerCase() === 'totals') continue;

    rows.push(row as unknown as CsvRow);
  }

  return rows;
}

/**
 * Parse a single CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);

  return result;
}

/**
 * Normalize CSV header to snake_case key
 */
function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Parse currency string to number (handles "$1,234.56" format)
 */
function parseCurrency(value: string | undefined): number | null {
  if (!value || value.trim() === '' || value.trim() === '-') return null;
  const cleaned = value.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Parse integer from string
 */
function parseInteger(value: string | undefined): number {
  if (!value || value.trim() === '' || value.trim() === '-') return 0;
  const num = parseInt(value.trim(), 10);
  return isNaN(num) ? 0 : num;
}

// =============================================================================
// DEALER OPERATIONS
// =============================================================================

/**
 * Create or update a dealer by account number
 */
export async function upsertDealer(
  row: CsvRow
): Promise<{ dealer: Dealer; isNew: boolean }> {
  const accountNumber = row.account?.trim();
  if (!accountNumber) {
    throw new Error('Account number is required');
  }

  // Determine manufacturer flags
  const hasR = row.r?.toLowerCase() === 'yes';
  const hasL = row.l?.toLowerCase() === 'yes';
  let mfgCode: string | null = null;
  if (hasR && hasL) mfgCode = 'both';
  else if (hasR) mfgCode = 'R';
  else if (hasL) mfgCode = 'L';

  // Normalize field variations (CSV headers may use different names)
  // "T/A" -> "t_a", "St" -> "st"
  const tradeName = row.trade_name || row.t_a || null;
  const stateVal = row.state || row.st || null;

  // Generate embedding for semantic search
  const searchText = [row.name, tradeName, row.city, stateVal]
    .filter(Boolean)
    .join(' ');
  const embedding = searchText ? await generateEmbedding(searchText) : null;
  const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;

  // Check if dealer exists
  const existing = await pool.query(
    'SELECT * FROM dealers WHERE account_number = $1',
    [accountNumber]
  );

  if (existing.rows.length > 0) {
    // Update existing dealer
    const result = await pool.query(
      `UPDATE dealers SET
        name = COALESCE($2, name),
        trade_name = COALESCE($3, trade_name),
        address = COALESCE($4, address),
        city = COALESCE($5, city),
        state = COALESCE($6, state),
        zip = COALESCE($7, zip),
        rep_name = COALESCE($8, rep_name),
        has_responsive = $9,
        has_lauzon = $10,
        manufacturer_code = COALESCE($11, manufacturer_code),
        embedding = COALESCE($12::vector, embedding),
        updated_at = NOW()
      WHERE account_number = $1
      RETURNING *`,
      [
        accountNumber,
        row.name || null,
        tradeName,
        row.address || null,
        row.city || null,
        stateVal,
        row.zip || null,
        row.rep || null,
        hasR || existing.rows[0].has_responsive,
        hasL || existing.rows[0].has_lauzon,
        mfgCode,
        embeddingStr,
      ]
    );
    return { dealer: result.rows[0] as Dealer, isNew: false };
  }

  // Create new dealer
  const result = await pool.query(
    `INSERT INTO dealers (
      account_number, name, trade_name, address, city, state, zip,
      rep_name, has_responsive, has_lauzon, manufacturer_code, embedding
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *`,
    [
      accountNumber,
      row.name || accountNumber,
      tradeName,
      row.address || null,
      row.city || null,
      stateVal,
      row.zip || null,
      row.rep || null,
      hasR,
      hasL,
      mfgCode,
      embeddingStr,
    ]
  );
  return { dealer: result.rows[0] as Dealer, isNew: true };
}

/**
 * Get dealer by account number
 */
export async function getDealerByAccount(
  accountNumber: string
): Promise<Dealer | null> {
  const result = await pool.query(
    'SELECT * FROM dealers WHERE account_number = $1 AND archived_at IS NULL',
    [accountNumber]
  );
  return result.rows[0] as Dealer | null;
}

/**
 * Get dealer by ID
 */
export async function getDealerById(id: string): Promise<Dealer | null> {
  const result = await pool.query(
    'SELECT * FROM dealers WHERE id = $1 AND archived_at IS NULL',
    [id]
  );
  return result.rows[0] as Dealer | null;
}

/**
 * Search dealers by name (fuzzy)
 */
export async function searchDealersByName(query: string): Promise<Dealer[]> {
  const result = await pool.query(
    `SELECT * FROM dealers
     WHERE archived_at IS NULL
       AND (
         LOWER(name) LIKE LOWER($1)
         OR LOWER(trade_name) LIKE LOWER($1)
         OR LOWER(account_number) LIKE LOWER($1)
       )
     ORDER BY name
     LIMIT 20`,
    [`%${query}%`]
  );
  return result.rows as Dealer[];
}

/**
 * Query dealers with filters
 */
export async function queryDealers(query: DealerQuery): Promise<{
  dealers: Dealer[];
  total: number;
}> {
  const conditions: string[] = ['archived_at IS NULL'];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (query.manufacturer) {
    if (query.manufacturer === 'responsive') {
      conditions.push('has_responsive = TRUE');
    } else if (query.manufacturer === 'lauzon') {
      conditions.push('has_lauzon = TRUE');
    } else if (query.manufacturer === 'both') {
      conditions.push('has_responsive = TRUE AND has_lauzon = TRUE');
    }
  }

  if (query.rep_name) {
    conditions.push(`LOWER(rep_name) LIKE LOWER($${paramIndex})`);
    params.push(`%${query.rep_name}%`);
    paramIndex++;
  }

  if (query.city) {
    conditions.push(`LOWER(city) = LOWER($${paramIndex})`);
    params.push(query.city);
    paramIndex++;
  }

  if (query.state) {
    conditions.push(`UPPER(state) = UPPER($${paramIndex})`);
    params.push(query.state);
    paramIndex++;
  }

  if (query.search) {
    conditions.push(
      `(LOWER(name) LIKE LOWER($${paramIndex}) OR LOWER(trade_name) LIKE LOWER($${paramIndex}) OR LOWER(account_number) LIKE LOWER($${paramIndex}))`
    );
    params.push(`%${query.search}%`);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  // Get total count
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM dealers WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Get paginated results
  const limit = query.limit || 50;
  const offset = query.offset || 0;

  const result = await pool.query(
    `SELECT * FROM dealers
     WHERE ${whereClause}
     ORDER BY name
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  return {
    dealers: result.rows as Dealer[],
    total,
  };
}

// =============================================================================
// DISPLAY WORK OPERATIONS
// =============================================================================

/**
 * Upsert display work items for a dealer from CSV row
 * Returns count of items created/updated
 */
export async function upsertDisplayWork(
  dealerId: string,
  importId: string,
  row: CsvRow
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  // Responsive displays
  const responsiveDisplays = [
    { type: 'Display', qty: parseInteger(row.respons_dsp) },
    { type: 'Showcase', qty: parseInteger(row.resp_showcase) },
    { type: 'Triple Tower', qty: parseInteger(row.resp_triple_tower) },
    { type: 'Two Tower', qty: parseInteger(row.resp_two_tower) },
    { type: 'Elite Conv', qty: parseInteger(row.resp_elite_conv) },
  ];

  const respSales = parseCurrency(row.resp_sales_2025);

  for (const display of responsiveDisplays) {
    if (display.qty > 0) {
      const res = await upsertSingleDisplayWork(
        dealerId,
        importId,
        'responsive',
        display.type,
        display.qty,
        respSales,
        '2025'
      );
      if (res.isNew) created++;
      else updated++;
    }
  }

  // Lauzon displays
  const lauzonDisplays = [
    { type: 'Display', qty: parseInteger(row.lauzon_dsp) },
    { type: 'Pure Series', qty: parseInteger(row.lzn_pure_series) },
    { type: 'Mini Rev', qty: parseInteger(row.lzn_mini_rev) },
    { type: 'Designer Influence', qty: parseInteger(row.lzn_desig_influ) },
    { type: 'Studio', qty: parseInteger(row.lzn_studio) },
    { type: 'Expert by Lauzon', qty: parseInteger(row.expert_by_lzn) },
    { type: 'Collection Studio', qty: parseInteger(row.lzn_coll_studio) },
  ];

  const lauzonSales = parseCurrency(row.lauzon_sales_2025);

  for (const display of lauzonDisplays) {
    if (display.qty > 0) {
      const res = await upsertSingleDisplayWork(
        dealerId,
        importId,
        'lauzon',
        display.type,
        display.qty,
        lauzonSales,
        '2025'
      );
      if (res.isNew) created++;
      else updated++;
    }
  }

  return { created, updated };
}

/**
 * Upsert a single display work item
 */
async function upsertSingleDisplayWork(
  dealerId: string,
  importId: string,
  manufacturer: string,
  displayType: string,
  quantity: number,
  salesAmount: number | null,
  salesPeriod: string
): Promise<{ isNew: boolean }> {
  // Check if exists
  const existing = await pool.query(
    `SELECT id FROM dealer_display_work
     WHERE dealer_id = $1 AND manufacturer = $2 AND display_type = $3 AND archived_at IS NULL`,
    [dealerId, manufacturer, displayType]
  );

  if (existing.rows.length > 0) {
    // Update existing
    await pool.query(
      `UPDATE dealer_display_work SET
        quantity = $1,
        sales_amount = $2,
        sales_period = $3,
        import_id = $4,
        updated_at = NOW()
      WHERE id = $5`,
      [quantity, salesAmount, salesPeriod, importId, existing.rows[0].id]
    );
    return { isNew: false };
  }

  // Create new
  await pool.query(
    `INSERT INTO dealer_display_work (
      dealer_id, import_id, manufacturer, display_type, quantity, sales_amount, sales_period
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [dealerId, importId, manufacturer, displayType, quantity, salesAmount, salesPeriod]
  );
  return { isNew: true };
}

/**
 * Get display work items for a dealer
 */
export async function getDisplayWorkByDealer(
  dealerId: string,
  manufacturer?: string
): Promise<DealerDisplayWork[]> {
  const conditions = ['dealer_id = $1', 'archived_at IS NULL'];
  const params: unknown[] = [dealerId];

  if (manufacturer) {
    conditions.push('manufacturer = $2');
    params.push(manufacturer);
  }

  const result = await pool.query(
    `SELECT * FROM dealer_display_work
     WHERE ${conditions.join(' AND ')}
     ORDER BY manufacturer, display_type`,
    params
  );

  return result.rows as DealerDisplayWork[];
}

/**
 * Query display work items with filters
 */
export async function queryDisplayWork(query: WorkQuery): Promise<{
  items: DealerDisplayWork[];
  total: number;
}> {
  const conditions: string[] = ['archived_at IS NULL'];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (query.dealer_id) {
    conditions.push(`dealer_id = $${paramIndex}`);
    params.push(query.dealer_id);
    paramIndex++;
  }

  if (query.manufacturer) {
    conditions.push(`manufacturer = $${paramIndex}`);
    params.push(query.manufacturer);
    paramIndex++;
  }

  if (query.display_type) {
    conditions.push(`display_type = $${paramIndex}`);
    params.push(query.display_type);
    paramIndex++;
  }

  if (query.status) {
    conditions.push(`status = $${paramIndex}`);
    params.push(query.status);
    paramIndex++;
  }

  if (query.min_quantity !== undefined) {
    conditions.push(`quantity >= $${paramIndex}`);
    params.push(query.min_quantity);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  // Get total count
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM dealer_display_work WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Get paginated results
  const limit = query.limit || 50;
  const offset = query.offset || 0;

  const result = await pool.query(
    `SELECT * FROM dealer_display_work
     WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  return {
    items: result.rows as DealerDisplayWork[],
    total,
  };
}

/**
 * Update display work item status
 */
export async function updateDisplayWorkStatus(
  workId: string,
  status: string,
  notes?: string
): Promise<DealerDisplayWork | null> {
  const updates: string[] = ['status = $2', 'updated_at = NOW()'];
  const params: unknown[] = [workId, status];
  let paramIndex = 3;

  if (notes !== undefined) {
    updates.push(`notes = $${paramIndex}`);
    params.push(notes);
    paramIndex++;
  }

  const result = await pool.query(
    `UPDATE dealer_display_work SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );

  return result.rows[0] as DealerDisplayWork | null;
}

// =============================================================================
// IMPORT OPERATIONS
// =============================================================================

/**
 * Create a new import record
 */
export async function createImportRecord(
  filename?: string,
  source = 'csv'
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO dealer_imports (filename, source, status)
     VALUES ($1, $2, 'processing')
     RETURNING id`,
    [filename || null, source]
  );
  return result.rows[0].id as string;
}

/**
 * Update import record with results
 */
export async function completeImportRecord(
  importId: string,
  stats: Omit<ImportResult, 'import_id'>
): Promise<void> {
  await pool.query(
    `UPDATE dealer_imports SET
      total_rows = $2,
      dealers_created = $3,
      dealers_updated = $4,
      work_items_created = $5,
      work_items_updated = $6,
      errors = $7,
      error_details = $8,
      status = 'completed',
      completed_at = NOW()
    WHERE id = $1`,
    [
      importId,
      stats.total_rows,
      stats.dealers_created,
      stats.dealers_updated,
      stats.work_items_created,
      stats.work_items_updated,
      stats.errors,
      stats.error_details,
    ]
  );
}

/**
 * Get import history
 */
export async function getImportHistory(limit = 20): Promise<DealerImport[]> {
  const result = await pool.query(
    `SELECT * FROM dealer_imports
     ORDER BY imported_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows as DealerImport[];
}

/**
 * Import dealers and display work from CSV content
 */
export async function importFromCsv(
  content: string,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const { filename, source = 'csv', onProgress } = options;

  // Parse CSV
  const rows = parseCsv(content);
  if (rows.length === 0) {
    throw new Error('No valid rows found in CSV');
  }

  // Create import record
  const importId = await createImportRecord(filename, source);

  const stats: Omit<ImportResult, 'import_id'> = {
    total_rows: rows.length,
    dealers_created: 0,
    dealers_updated: 0,
    work_items_created: 0,
    work_items_updated: 0,
    errors: 0,
    error_details: [],
  };

  // Process each row
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;

    if (onProgress) {
      onProgress(i + 1, rows.length, row.name || row.account || 'Unknown');
    }

    try {
      // Upsert dealer
      const { dealer, isNew } = await upsertDealer(row);
      if (isNew) {
        stats.dealers_created++;
      } else {
        stats.dealers_updated++;
      }

      // Upsert display work items
      const workResult = await upsertDisplayWork(dealer.id, importId, row);
      stats.work_items_created += workResult.created;
      stats.work_items_updated += workResult.updated;
    } catch (error) {
      stats.errors++;
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      stats.error_details.push(
        `Row ${i + 1} (${row.account || 'unknown'}): ${errorMsg}`
      );
    }
  }

  // Complete import record
  await completeImportRecord(importId, stats);

  return {
    import_id: importId,
    ...stats,
  };
}

// =============================================================================
// SUMMARY & ANALYTICS
// =============================================================================

/**
 * Get summary statistics for dealers and display work
 */
export async function getDealerSummary(): Promise<{
  total_dealers: number;
  responsive_dealers: number;
  lauzon_dealers: number;
  both_dealers: number;
  total_display_items: number;
  by_manufacturer: Record<string, number>;
  by_display_type: Record<string, number>;
  by_status: Record<string, number>;
  total_sales: { responsive: number; lauzon: number };
}> {
  // Dealer counts
  const dealerCounts = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE has_responsive AND NOT has_lauzon) as responsive_only,
      COUNT(*) FILTER (WHERE has_lauzon AND NOT has_responsive) as lauzon_only,
      COUNT(*) FILTER (WHERE has_responsive AND has_lauzon) as both
    FROM dealers
    WHERE archived_at IS NULL
  `);

  const dc = dealerCounts.rows[0];

  // Work item counts by manufacturer
  const mfrCounts = await pool.query(`
    SELECT manufacturer, COUNT(*) as count
    FROM dealer_display_work
    WHERE archived_at IS NULL
    GROUP BY manufacturer
  `);
  const byManufacturer: Record<string, number> = {};
  for (const row of mfrCounts.rows) {
    byManufacturer[row.manufacturer] = parseInt(row.count, 10);
  }

  // Work item counts by display type
  const typeCounts = await pool.query(`
    SELECT display_type, COUNT(*) as count
    FROM dealer_display_work
    WHERE archived_at IS NULL
    GROUP BY display_type
    ORDER BY count DESC
  `);
  const byDisplayType: Record<string, number> = {};
  for (const row of typeCounts.rows) {
    byDisplayType[row.display_type] = parseInt(row.count, 10);
  }

  // Work item counts by status
  const statusCounts = await pool.query(`
    SELECT status, COUNT(*) as count
    FROM dealer_display_work
    WHERE archived_at IS NULL
    GROUP BY status
  `);
  const byStatus: Record<string, number> = {};
  for (const row of statusCounts.rows) {
    byStatus[row.status] = parseInt(row.count, 10);
  }

  // Total sales by manufacturer
  const salesTotals = await pool.query(`
    SELECT manufacturer, SUM(sales_amount) as total
    FROM dealer_display_work
    WHERE archived_at IS NULL AND sales_amount IS NOT NULL
    GROUP BY manufacturer
  `);
  const totalSales = { responsive: 0, lauzon: 0 };
  for (const row of salesTotals.rows) {
    if (row.manufacturer === 'responsive') {
      totalSales.responsive = parseFloat(row.total) || 0;
    } else if (row.manufacturer === 'lauzon') {
      totalSales.lauzon = parseFloat(row.total) || 0;
    }
  }

  // Total work items
  const totalItems = await pool.query(`
    SELECT COUNT(*) as count FROM dealer_display_work WHERE archived_at IS NULL
  `);

  return {
    total_dealers: parseInt(dc.total, 10),
    responsive_dealers:
      parseInt(dc.responsive_only, 10) + parseInt(dc.both, 10),
    lauzon_dealers: parseInt(dc.lauzon_only, 10) + parseInt(dc.both, 10),
    both_dealers: parseInt(dc.both, 10),
    total_display_items: parseInt(totalItems.rows[0].count, 10),
    by_manufacturer: byManufacturer,
    by_display_type: byDisplayType,
    by_status: byStatus,
    total_sales: totalSales,
  };
}

/**
 * Get dealers with their display work (joined view)
 */
export async function getDealersWithWork(
  manufacturer?: string,
  limit = 50
): Promise<
  Array<Dealer & { display_work: DealerDisplayWork[] }>
> {
  const conditions = ['d.archived_at IS NULL'];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (manufacturer) {
    if (manufacturer === 'responsive') {
      conditions.push('d.has_responsive = TRUE');
    } else if (manufacturer === 'lauzon') {
      conditions.push('d.has_lauzon = TRUE');
    }
  }

  const dealersResult = await pool.query(
    `SELECT d.* FROM dealers d
     WHERE ${conditions.join(' AND ')}
     ORDER BY d.name
     LIMIT $${paramIndex}`,
    [...params, limit]
  );

  const dealers = dealersResult.rows as Dealer[];
  const result: Array<Dealer & { display_work: DealerDisplayWork[] }> = [];

  for (const dealer of dealers) {
    const work = await getDisplayWorkByDealer(dealer.id, manufacturer);
    result.push({ ...dealer, display_work: work });
  }

  return result;
}

/**
 * Export dealers to CSV format
 */
export async function exportToCsv(
  manufacturer?: string
): Promise<string> {
  const dealers = await getDealersWithWork(manufacturer, 1000);

  const headers = [
    'Account',
    'Name',
    'Trade Name',
    'Rep',
    'Address',
    'City',
    'State',
    'Zip',
    'Manufacturer',
    'Display Type',
    'Quantity',
    'Sales Amount',
    'Sales Period',
    'Status',
  ];

  const rows: string[] = [headers.join(',')];

  for (const dealer of dealers) {
    for (const work of dealer.display_work) {
      const row = [
        escapeCsvField(dealer.account_number),
        escapeCsvField(dealer.name),
        escapeCsvField(dealer.trade_name || ''),
        escapeCsvField(dealer.rep_name || ''),
        escapeCsvField(dealer.address || ''),
        escapeCsvField(dealer.city || ''),
        escapeCsvField(dealer.state || ''),
        escapeCsvField(dealer.zip || ''),
        escapeCsvField(work.manufacturer),
        escapeCsvField(work.display_type),
        work.quantity.toString(),
        work.sales_amount?.toString() || '',
        escapeCsvField(work.sales_period || ''),
        escapeCsvField(work.status),
      ];
      rows.push(row.join(','));
    }
  }

  return rows.join('\n');
}

/**
 * Escape a field for CSV output
 */
function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
