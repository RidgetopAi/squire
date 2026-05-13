/**
 * Dealer foundation and flexible campaign service.
 *
 * Dealers remain the canonical account layer. Displays, programs, sales,
 * campaign tasks, and campaign entries attach to dealers without requiring
 * new tables for each new promotion or tracker.
 */

import { createHash } from 'crypto';
import { readdir, readFile } from 'fs/promises';
import { basename, join } from 'path';
import { pool } from '../../db/pool.js';

type CsvRow = Record<string, string>;

export interface DealerFoundationImportOptions {
  directory: string;
  deactivateMissingDisplays?: boolean;
  deactivateMissingPrograms?: boolean;
  includeSalesExample?: boolean;
  salesPeriodStart?: string;
  salesPeriodEnd?: string;
}

export interface DealerFoundationImportResult {
  dealers_created: number;
  dealers_updated: number;
  aliases_upserted: number;
  displays_upserted: number;
  displays_deactivated: number;
  programs_upserted: number;
  programs_deactivated: number;
  sales_rows_upserted: number;
  errors: string[];
}

export interface CreateDealerCampaignInput {
  name: string;
  campaign_type?: string;
  status?: string;
  period_start?: string;
  period_end?: string;
  point_rule?: string;
  metadata?: Record<string, unknown>;
}

export interface GenerateDisplayCampaignTasksInput {
  campaign_name: string;
  display_codes?: string[];
  task_types: string[];
  due_at?: string;
  status?: string;
}

export interface QueryCampaignTasksInput {
  campaign_name?: string;
  dealer_search?: string;
  display_code?: string;
  task_type?: string;
  status?: string;
  limit?: number;
}

export interface UpdateCampaignTaskInput {
  task_id?: string;
  campaign_name?: string;
  dealer_search?: string;
  account_number?: string;
  display_code?: string;
  task_type?: string;
  status: string;
  notes?: string | null;
}

export interface RecordCampaignSaleInput {
  campaign_name: string;
  dealer_search?: string;
  account_number?: string;
  manufacturer?: string;
  item_name: string;
  quantity: number;
  entry_date?: string;
  value?: number;
  cost?: number;
  profit?: number;
  notes?: string;
}

export interface CampaignReportInput {
  campaign_name: string;
  limit?: number;
}

const DISPLAY_FILE_NAMES = new Set([
  'adura-pro-displays.csv',
  'apex-displays.csv',
  'bjelin-displays.csv',
  'lauzon-expert-displays.csv',
  'lauzon-partner-displays.csv',
  'lvs-displays.csv',
  'mannington-hardwood-displays.csv',
  'responsive-displays.csv',
  'restorations-laminate-displays.csv',
  'sar-displays.csv',
  'somerset-displays.csv',
]);

const DISPLAY_TYPE_LABELS: Record<string, { name: string; vendor?: string; category?: string }> = {
  adura_pro: { name: 'Adura Pro', vendor: 'Mannington', category: 'display' },
  apex: { name: 'Apex', category: 'display' },
  bjelin: { name: 'Bjelin', vendor: 'Bjelin', category: 'display' },
  lauzon_expert: { name: 'Lauzon Expert', vendor: 'Lauzon', category: 'display' },
  lauzon_partner: { name: 'Lauzon Partner', vendor: 'Lauzon', category: 'display' },
  lvs: { name: 'LVS', category: 'display' },
  mannington_hardwood: { name: 'Mannington Hardwood', vendor: 'Mannington', category: 'display' },
  responsive: { name: 'Responsive', vendor: 'Responsive', category: 'display' },
  restorations_laminate: { name: 'Restorations Laminate', vendor: 'Mannington', category: 'display' },
  sar: { name: 'SAR', category: 'display' },
  somerset: { name: 'Somerset', vendor: 'Somerset', category: 'display' },
};

// =============================================================================
// CSV HELPERS
// =============================================================================

function parseCsv(content: string): CsvRow[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]!.replace(/^\uFEFF/, '')).map(normalizeHeader);
  return lines
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = parseCsvLine(line);
      const row: CsvRow = {};
      for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        if (header) row[header] = values[i]?.trim() ?? '';
      }
      return row;
    });
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
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

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeName(value: string): string {
  return value
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\b(INC|LLC|CO|COMPANY|CORP|CORPORATION)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function hashRow(row: CsvRow): string {
  return hashContent(JSON.stringify(row));
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[$,%\s,]/g, '');
  if (cleaned === '' || cleaned === '-') return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,%\s,]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanTradeName(address1: string, accountName: string): string | null {
  const trimmed = address1.trim();
  if (!trimmed || normalizeName(trimmed) === normalizeName(accountName)) return null;
  if (/^(T\/A|DBA)\s+/i.test(trimmed)) {
    return trimmed.replace(/^(T\/A|DBA)\s+/i, '').trim();
  }
  return null;
}

function masterAddress(row: CsvRow): {
  tradeName: string | null;
  line1: string | null;
  line2: string | null;
  line3: string | null;
  line4: string | null;
  combined: string | null;
} {
  const accountName = row.customer_parent_account ?? '';
  const address1 = row.address1 ?? '';
  const tradeName = cleanTradeName(address1, accountName);
  const rawLines = [
    tradeName ? row.address2 : row.address1,
    tradeName ? row.address3 : row.address2,
    tradeName ? row.address4 : row.address3,
    tradeName ? undefined : row.address4,
  ].map((value) => value?.trim()).filter(Boolean) as string[];

  const [line1, line2, line3, line4] = rawLines;
  return {
    tradeName,
    line1: line1 ?? null,
    line2: line2 ?? null,
    line3: line3 ?? null,
    line4: line4 ?? null,
    combined: rawLines.length > 0 ? rawLines.join(', ') : null,
  };
}

function displayCodeFromFilename(filename: string): string {
  return filename.replace(/\.csv$/i, '').replace(/-displays$/i, '').replace(/-/g, '_');
}

// =============================================================================
// IMPORT HELPERS
// =============================================================================

async function createDataImport(
  importType: string,
  filename: string,
  content: string,
  rowCount: number,
  periodStart?: string,
  periodEnd?: string,
  metadata: Record<string, unknown> = {}
): Promise<string> {
  const sourceHash = hashContent(content);
  const result = await pool.query(
    `INSERT INTO dealer_data_imports (
      import_type, filename, source, source_hash, row_count, period_start, period_end,
      status, metadata, completed_at
    )
    VALUES ($1, $2, 'csv', $3, $4, $5, $6, 'completed', $7, NOW())
    ON CONFLICT (source_hash) WHERE source_hash IS NOT NULL
    DO UPDATE SET
      row_count = EXCLUDED.row_count,
      period_start = COALESCE(EXCLUDED.period_start, dealer_data_imports.period_start),
      period_end = COALESCE(EXCLUDED.period_end, dealer_data_imports.period_end),
      metadata = dealer_data_imports.metadata || EXCLUDED.metadata,
      imported_at = NOW(),
      completed_at = NOW()
    RETURNING id`,
    [
      importType,
      filename,
      sourceHash,
      rowCount,
      periodStart ?? null,
      periodEnd ?? null,
      JSON.stringify(metadata),
    ]
  );
  return result.rows[0].id as string;
}

async function upsertDealerAlias(
  dealerId: string,
  aliasName: string | null | undefined,
  aliasType: string,
  source: string,
  isPrimary = false
): Promise<boolean> {
  if (!aliasName?.trim()) return false;
  await pool.query(
    `INSERT INTO dealer_aliases (
      dealer_id, alias_name, normalized_alias, alias_type, source, is_primary
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (dealer_id, normalized_alias)
    DO UPDATE SET
      alias_name = EXCLUDED.alias_name,
      alias_type = EXCLUDED.alias_type,
      source = EXCLUDED.source,
      is_primary = dealer_aliases.is_primary OR EXCLUDED.is_primary,
      updated_at = NOW()`,
    [dealerId, aliasName.trim(), normalizeName(aliasName), aliasType, source, isPrimary]
  );
  return true;
}

async function findDealerByNameOrAlias(name: string): Promise<{ id: string; account_number: string; name: string } | null> {
  const normalized = normalizeName(name);
  const result = await pool.query(
    `SELECT d.id, d.account_number, d.name
     FROM dealers d
     LEFT JOIN dealer_aliases da ON da.dealer_id = d.id
     WHERE d.archived_at IS NULL
       AND (d.normalized_name = $1 OR da.normalized_alias = $1)
     ORDER BY da.is_primary DESC NULLS LAST, d.name
     LIMIT 1`,
    [normalized]
  );
  return result.rows[0] ?? null;
}

async function findDealer(input: { account_number?: string; dealer_search?: string }): Promise<{ id: string; account_number: string; name: string } | null> {
  if (input.account_number) {
    const result = await pool.query(
      `SELECT id, account_number, name FROM dealers
       WHERE archived_at IS NULL
         AND (account_number = $1 OR split_part(account_number, '~', 1) = $1)
       LIMIT 1`,
      [input.account_number]
    );
    if (result.rows[0]) return result.rows[0];
  }

  if (input.dealer_search) {
    const exact = await findDealerByNameOrAlias(input.dealer_search);
    if (exact) return exact;

    const result = await pool.query(
      `SELECT id, account_number, name FROM dealers
       WHERE archived_at IS NULL
         AND (LOWER(name) LIKE LOWER($1) OR LOWER(trade_name) LIKE LOWER($1))
       ORDER BY name
       LIMIT 1`,
      [`%${input.dealer_search}%`]
    );
    return result.rows[0] ?? null;
  }

  return null;
}

async function getCampaignByName(name: string): Promise<{ id: string; name: string } | null> {
  const result = await pool.query(
    `SELECT id, name FROM dealer_campaigns WHERE normalized_name = $1 LIMIT 1`,
    [normalizeKey(name)]
  );
  return result.rows[0] ?? null;
}

async function ensureDisplayType(code: string): Promise<string> {
  const display = DISPLAY_TYPE_LABELS[code] ?? {
    name: code.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    category: 'display',
  };
  const result = await pool.query(
    `INSERT INTO dealer_display_types (code, display_name, vendor, category)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (code)
     DO UPDATE SET
       display_name = EXCLUDED.display_name,
       vendor = COALESCE(EXCLUDED.vendor, dealer_display_types.vendor),
       category = COALESCE(EXCLUDED.category, dealer_display_types.category),
       updated_at = NOW()
     RETURNING id`,
    [code, display.name, display.vendor ?? null, display.category ?? null]
  );
  return result.rows[0].id as string;
}

// =============================================================================
// FOUNDATION IMPORT
// =============================================================================

export async function importDealerFoundation(
  options: DealerFoundationImportOptions
): Promise<DealerFoundationImportResult> {
  const stats: DealerFoundationImportResult = {
    dealers_created: 0,
    dealers_updated: 0,
    aliases_upserted: 0,
    displays_upserted: 0,
    displays_deactivated: 0,
    programs_upserted: 0,
    programs_deactivated: 0,
    sales_rows_upserted: 0,
    errors: [],
  };

  const masterPath = join(options.directory, 'master-dealer-list.csv');
  const masterContent = await readFile(masterPath, 'utf-8');
  const masterRows = parseCsv(masterContent);
  const masterImportId = await createDataImport(
    'dealer_master',
    'master-dealer-list.csv',
    masterContent,
    masterRows.length
  );

  for (const row of masterRows) {
    const accountNumber = row.customer_parent_account_number?.trim();
    const accountName = row.customer_parent_account?.trim();
    if (!accountNumber || !accountName) {
      stats.errors.push(`Master row missing account number or name: ${JSON.stringify(row)}`);
      continue;
    }

    const address = masterAddress(row);
    const existing = await pool.query('SELECT id FROM dealers WHERE account_number = $1', [accountNumber]);
    const result = await pool.query(
      `INSERT INTO dealers (
        account_number, name, trade_name, address, city, state, zip, metadata,
        normalized_name, address_line1, address_line2, address_line3, address_line4,
        country, source_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
      ON CONFLICT (account_number)
      DO UPDATE SET
        name = EXCLUDED.name,
        trade_name = EXCLUDED.trade_name,
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip = EXCLUDED.zip,
        metadata = dealers.metadata || EXCLUDED.metadata,
        normalized_name = EXCLUDED.normalized_name,
        address_line1 = EXCLUDED.address_line1,
        address_line2 = EXCLUDED.address_line2,
        address_line3 = EXCLUDED.address_line3,
        address_line4 = EXCLUDED.address_line4,
        country = EXCLUDED.country,
        source_updated_at = NOW(),
        updated_at = NOW()
      RETURNING id`,
      [
        accountNumber,
        accountName,
        address.tradeName,
        address.combined,
        row.town || null,
        row.state || null,
        row.postcode || null,
        JSON.stringify({
          source_import_id: masterImportId,
          master_metrics: {
            value: parseNumber(row.value),
            cost: parseNumber(row.cost),
            profit: parseNumber(row.profit),
            gross_profit: row.gp || null,
            avg_price: parseOptionalNumber(row.average_price),
            quantity: parseNumber(row.quantity),
            order_count: parseNumber(row.count),
          },
        }),
        normalizeName(accountName),
        address.line1,
        address.line2,
        address.line3,
        address.line4,
        row.country || null,
      ]
    );

    if (existing.rowCount === 0) stats.dealers_created++;
    else stats.dealers_updated++;

    const dealerId = result.rows[0].id as string;
    if (await upsertDealerAlias(dealerId, accountName, 'account_name', 'master-dealer-list.csv', true)) {
      stats.aliases_upserted++;
    }
    if (await upsertDealerAlias(dealerId, accountNumber, 'account_number', 'master-dealer-list.csv')) {
      stats.aliases_upserted++;
    }
    if (await upsertDealerAlias(dealerId, address.tradeName, 'trade_name', 'master-dealer-list.csv')) {
      stats.aliases_upserted++;
    }
  }

  const files = await readdir(options.directory);
  for (const filename of files.sort()) {
    if (!DISPLAY_FILE_NAMES.has(filename)) continue;
    const displayStats = await importDisplayRoster(
      join(options.directory, filename),
      filename,
      options.deactivateMissingDisplays ?? false
    );
    stats.displays_upserted += displayStats.upserted;
    stats.displays_deactivated += displayStats.deactivated;
    stats.aliases_upserted += displayStats.aliases;
    stats.errors.push(...displayStats.errors);
  }

  if (files.includes('program-dealers.csv')) {
    const programStats = await importProgramDealers(
      join(options.directory, 'program-dealers.csv'),
      options.deactivateMissingPrograms ?? false
    );
    stats.programs_upserted += programStats.upserted;
    stats.programs_deactivated += programStats.deactivated;
    stats.aliases_upserted += programStats.aliases;
    stats.errors.push(...programStats.errors);
  }

  if (options.includeSalesExample) {
    if (!options.salesPeriodStart || !options.salesPeriodEnd) {
      throw new Error('salesPeriodStart and salesPeriodEnd are required when includeSalesExample is true');
    }
    const salesStats = await importSalesReport(
      join(options.directory, 'sales-report-example.csv'),
      options.salesPeriodStart,
      options.salesPeriodEnd
    );
    stats.sales_rows_upserted += salesStats.upserted;
    stats.errors.push(...salesStats.errors);
  }

  return stats;
}

async function importDisplayRoster(
  filePath: string,
  filename: string,
  deactivateMissing: boolean
): Promise<{ upserted: number; deactivated: number; aliases: number; errors: string[] }> {
  const content = await readFile(filePath, 'utf-8');
  const rows = parseCsv(content);
  const importId = await createDataImport('display_roster', filename, content, rows.length, undefined, undefined, {
    display_code: displayCodeFromFilename(filename),
  });
  const displayCode = displayCodeFromFilename(filename);
  const displayTypeId = await ensureDisplayType(displayCode);
  let upserted = 0;
  let deactivated = 0;
  let aliases = 0;
  const errors: string[] = [];
  const seenDealerIds: string[] = [];

  for (const row of rows) {
    const sourceName = row.customer_parent_account || row.customer_name;
    if (!sourceName || sourceName.toLowerCase() === 'totals') continue;
    const dealer = await findDealerByNameOrAlias(sourceName);
    if (!dealer) {
      errors.push(`${filename}: no dealer match for "${sourceName}"`);
      continue;
    }
    seenDealerIds.push(dealer.id);
    if (await upsertDealerAlias(dealer.id, sourceName, 'source_name', filename)) aliases++;

    await pool.query(
      `INSERT INTO dealer_displays (
        dealer_id, display_type_id, source_import_id, active, last_seen_at, metadata
      )
      VALUES ($1, $2, $3, TRUE, NOW(), $4)
      ON CONFLICT (dealer_id, display_type_id) DO UPDATE SET
        source_import_id = EXCLUDED.source_import_id,
        active = TRUE,
        removed_at = NULL,
        last_seen_at = NOW(),
        metadata = dealer_displays.metadata || EXCLUDED.metadata,
        updated_at = NOW()`,
      [
        dealer.id,
        displayTypeId,
        importId,
        JSON.stringify({
          source_filename: filename,
          source_metrics: {
            value: parseNumber(row.value),
            cost: parseNumber(row.cost),
            profit: parseNumber(row.profit),
            gross_profit: row.gp || null,
            avg_price: parseOptionalNumber(row.average_price),
            quantity: parseNumber(row.quantity),
            order_count: parseNumber(row.count),
          },
        }),
      ]
    );
    upserted++;
  }

  if (deactivateMissing) {
    const result = await pool.query(
      `UPDATE dealer_displays
       SET active = FALSE, removed_at = NOW(), updated_at = NOW()
       WHERE display_type_id = $1
         AND active = TRUE
         AND NOT (dealer_id = ANY($2::uuid[]))`,
      [displayTypeId, seenDealerIds]
    );
    deactivated = result.rowCount ?? 0;
  }

  return { upserted, deactivated, aliases, errors };
}

async function importProgramDealers(
  filePath: string,
  deactivateMissing: boolean
): Promise<{ upserted: number; deactivated: number; aliases: number; errors: string[] }> {
  const content = await readFile(filePath, 'utf-8');
  const rows = parseCsv(content);
  const importId = await createDataImport('program_membership', 'program-dealers.csv', content, rows.length);
  let upserted = 0;
  let deactivated = 0;
  let aliases = 0;
  const errors: string[] = [];
  const seen: Array<{ dealerId: string; program: string }> = [];

  for (const row of rows) {
    const sourceName = row.customer_parent_account;
    const programName = row.customer_c;
    if (!sourceName || !programName || sourceName.toLowerCase() === 'totals') continue;
    const dealer = await findDealerByNameOrAlias(sourceName);
    if (!dealer) {
      errors.push(`program-dealers.csv: no dealer match for "${sourceName}"`);
      continue;
    }
    if (await upsertDealerAlias(dealer.id, sourceName, 'source_name', 'program-dealers.csv')) aliases++;
    seen.push({ dealerId: dealer.id, program: normalizeKey(programName) });

    await pool.query(
      `INSERT INTO dealer_program_memberships (
        dealer_id, program_name, normalized_program_name, source_import_id, active, last_seen_at, metadata
      )
      VALUES ($1, $2, $3, $4, TRUE, NOW(), $5)
      ON CONFLICT (dealer_id, normalized_program_name) DO UPDATE SET
        program_name = EXCLUDED.program_name,
        source_import_id = EXCLUDED.source_import_id,
        active = TRUE,
        removed_at = NULL,
        last_seen_at = NOW(),
        metadata = dealer_program_memberships.metadata || EXCLUDED.metadata,
        updated_at = NOW()`,
      [
        dealer.id,
        programName.trim(),
        normalizeKey(programName),
        importId,
        JSON.stringify({
          source_filename: 'program-dealers.csv',
          source_metrics: {
            value: parseNumber(row.value),
            cost: parseNumber(row.cost),
            profit: parseNumber(row.profit),
            gross_profit: row.gp || null,
            avg_price: parseOptionalNumber(row.average_price),
            quantity: parseNumber(row.quantity),
            order_count: parseNumber(row.count),
          },
        }),
      ]
    );
    upserted++;
  }

  if (deactivateMissing) {
    const result = await pool.query(
      `UPDATE dealer_program_memberships dpm
       SET active = FALSE, removed_at = NOW(), updated_at = NOW()
       WHERE active = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS seen(dealer_id uuid, program text)
           WHERE seen.dealer_id = dpm.dealer_id
             AND seen.program = dpm.normalized_program_name
         )`,
      [JSON.stringify(seen.map((row) => ({ dealer_id: row.dealerId, program: row.program })))]
    );
    deactivated = result.rowCount ?? 0;
  }

  return { upserted, deactivated, aliases, errors };
}

export async function importSalesReport(
  filePath: string,
  periodStart: string,
  periodEnd: string
): Promise<{ upserted: number; errors: string[] }> {
  const content = await readFile(filePath, 'utf-8');
  const rows = parseCsv(content);
  const importId = await createDataImport(
    'sales_report',
    basename(filePath),
    content,
    rows.length,
    periodStart,
    periodEnd
  );
  let upserted = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const accountNumber = row.customer_parent_account_number;
    const productCategory = row.product_group_c_o_l0;
    if (!accountNumber || !productCategory) continue;
    const dealer = await findDealer({ account_number: accountNumber });
    if (!dealer) {
      errors.push(`${basename(filePath)}: no dealer match for account "${accountNumber}"`);
      continue;
    }

    await pool.query(
      `INSERT INTO dealer_sales_by_category (
        dealer_id, import_id, period_start, period_end, product_category,
        value, cost, profit, gross_profit_percent, avg_price, quantity,
        order_count, source_row_hash, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (dealer_id, product_category, period_start, period_end)
      DO UPDATE SET
        import_id = EXCLUDED.import_id,
        value = EXCLUDED.value,
        cost = EXCLUDED.cost,
        profit = EXCLUDED.profit,
        gross_profit_percent = EXCLUDED.gross_profit_percent,
        avg_price = EXCLUDED.avg_price,
        quantity = EXCLUDED.quantity,
        order_count = EXCLUDED.order_count,
        source_row_hash = EXCLUDED.source_row_hash,
        metadata = dealer_sales_by_category.metadata || EXCLUDED.metadata,
        updated_at = NOW()`,
      [
        dealer.id,
        importId,
        periodStart,
        periodEnd,
        productCategory.trim(),
        parseNumber(row.value),
        parseNumber(row.cost),
        parseNumber(row.profit),
        parseOptionalNumber(row.gp),
        parseOptionalNumber(row.average_price),
        parseNumber(row.quantity),
        Math.trunc(parseNumber(row.count)),
        hashRow(row),
        JSON.stringify({ source_filename: basename(filePath) }),
      ]
    );
    upserted++;
  }

  return { upserted, errors };
}

// =============================================================================
// CAMPAIGNS
// =============================================================================

export async function createDealerCampaign(input: CreateDealerCampaignInput): Promise<Record<string, unknown>> {
  const result = await pool.query(
    `INSERT INTO dealer_campaigns (
      name, normalized_name, campaign_type, status, period_start, period_end, point_rule, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (normalized_name)
    DO UPDATE SET
      name = EXCLUDED.name,
      campaign_type = EXCLUDED.campaign_type,
      status = EXCLUDED.status,
      period_start = EXCLUDED.period_start,
      period_end = EXCLUDED.period_end,
      point_rule = EXCLUDED.point_rule,
      metadata = dealer_campaigns.metadata || EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING *`,
    [
      input.name,
      normalizeKey(input.name),
      input.campaign_type ?? 'general',
      input.status ?? 'active',
      input.period_start ?? null,
      input.period_end ?? null,
      input.point_rule ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  return result.rows[0];
}

export async function importCampaignItemsFromCsv(
  campaignName: string,
  filePath: string
): Promise<{ campaign_id: string; items_upserted: number; errors: string[] }> {
  const campaign = await getCampaignByName(campaignName);
  if (!campaign) throw new Error(`Campaign not found: ${campaignName}`);

  const content = await readFile(filePath, 'utf-8');
  const rows = parseCsv(content);
  const importId = await createDataImport('campaign_catalog', basename(filePath), content, rows.length, undefined, undefined, {
    campaign_id: campaign.id,
  });
  let itemsUpserted = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const itemName = row.item || row.item_name || row.product || row.product_name;
    if (!itemName) {
      errors.push(`Campaign catalog row missing item name: ${JSON.stringify(row)}`);
      continue;
    }

    const manufacturer = row.manufacturer || row.manufacture || null;
    const itemSku = row.sku || row.item_sku || null;
    const existing = await pool.query(
      `SELECT id FROM dealer_campaign_items
       WHERE campaign_id = $1
         AND COALESCE(manufacturer, '') = COALESCE($2, '')
         AND normalized_item_name = $3
         AND COALESCE(item_sku, '') = COALESCE($4, '')
       LIMIT 1`,
      [campaign.id, manufacturer, normalizeKey(itemName), itemSku]
    );

    const params = [
      campaign.id,
      manufacturer,
      itemName.trim(),
      normalizeKey(itemName),
      itemSku,
      row.product_category || row.category || null,
      row.unit || null,
      parseNumber(row.point_value || row.points),
      JSON.stringify({ source_import_id: importId, source_filename: basename(filePath) }),
    ];

    if (existing.rows[0]) {
      await pool.query(
        `UPDATE dealer_campaign_items
         SET manufacturer = $1,
           item_name = $2,
           normalized_item_name = $3,
           item_sku = $4,
           product_category = $5,
           unit = $6,
           point_value = $7,
           is_active = TRUE,
           metadata = metadata || $8,
           updated_at = NOW()
         WHERE id = $9`,
        [...params.slice(1), existing.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO dealer_campaign_items (
          campaign_id, manufacturer, item_name, normalized_item_name, item_sku,
          product_category, unit, point_value, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        params
      );
    }
    itemsUpserted++;
  }

  return { campaign_id: campaign.id, items_upserted: itemsUpserted, errors };
}

export async function generateDisplayCampaignTasks(
  input: GenerateDisplayCampaignTasksInput
): Promise<{ campaign_id: string; tasks_upserted: number }> {
  const campaign = await getCampaignByName(input.campaign_name);
  if (!campaign) throw new Error(`Campaign not found: ${input.campaign_name}`);

  const displayCodes = input.display_codes?.map(normalizeKey);
  const params: unknown[] = [campaign.id, input.task_types, input.due_at ?? null, input.status ?? 'pending'];
  let displayFilter = '';

  if (displayCodes && displayCodes.length > 0) {
    params.push(displayCodes);
    displayFilter = `AND ddt.code = ANY($${params.length}::text[])`;
  }

  const result = await pool.query(
    `WITH source_rows AS (
      SELECT
        $1::uuid AS campaign_id,
        dd.dealer_id,
        dd.id AS dealer_display_id,
        unnest($2::text[]) AS task_type,
        $3::timestamptz AS due_at,
        $4::text AS status
      FROM dealer_displays dd
      JOIN dealer_display_types ddt ON ddt.id = dd.display_type_id
      WHERE dd.active = TRUE
        ${displayFilter}
    ),
    updated_rows AS (
      UPDATE dealer_campaign_tasks dct
      SET due_at = COALESCE(sr.due_at, dct.due_at),
        status = CASE
          WHEN dct.status = 'done' THEN dct.status
          ELSE sr.status
        END,
        updated_at = NOW()
      FROM source_rows sr
      WHERE dct.campaign_id = sr.campaign_id
        AND dct.dealer_id = sr.dealer_id
        AND dct.dealer_display_id = sr.dealer_display_id
        AND dct.campaign_item_id IS NULL
        AND dct.task_type = sr.task_type
      RETURNING dct.id
    ),
    inserted_rows AS (
      INSERT INTO dealer_campaign_tasks (
        campaign_id, dealer_id, dealer_display_id, task_type, due_at, status
      )
      SELECT
        sr.campaign_id,
        sr.dealer_id,
        sr.dealer_display_id,
        sr.task_type,
        sr.due_at,
        sr.status
      FROM source_rows sr
      WHERE NOT EXISTS (
        SELECT 1
        FROM dealer_campaign_tasks dct
        WHERE dct.campaign_id = sr.campaign_id
          AND dct.dealer_id = sr.dealer_id
          AND dct.dealer_display_id = sr.dealer_display_id
          AND dct.campaign_item_id IS NULL
          AND dct.task_type = sr.task_type
      )
      RETURNING id
    )
    SELECT id FROM updated_rows
    UNION ALL
    SELECT id FROM inserted_rows`,
    params
  );

  return { campaign_id: campaign.id, tasks_upserted: result.rowCount ?? 0 };
}

export async function queryCampaignTasks(input: QueryCampaignTasksInput): Promise<Record<string, unknown>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let index = 1;

  if (input.campaign_name) {
    conditions.push(`dc.normalized_name = $${index++}`);
    params.push(normalizeKey(input.campaign_name));
  }
  if (input.status) {
    conditions.push(`dct.status = $${index++}`);
    params.push(input.status);
  }
  if (input.task_type) {
    conditions.push(`dct.task_type = $${index++}`);
    params.push(input.task_type);
  }
  if (input.display_code) {
    conditions.push(`ddt.code = $${index++}`);
    params.push(normalizeKey(input.display_code));
  }
  if (input.dealer_search) {
    conditions.push(`(LOWER(d.name) LIKE LOWER($${index}) OR LOWER(d.trade_name) LIKE LOWER($${index}) OR LOWER(d.account_number) LIKE LOWER($${index}))`);
    params.push(`%${input.dealer_search}%`);
    index++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = input.limit ?? 50;

  const result = await pool.query(
    `SELECT
      dct.id,
      dc.name AS campaign_name,
      d.account_number,
      d.name AS dealer_name,
      d.trade_name,
      ddt.code AS display_code,
      ddt.display_name,
      dct.task_type,
      dct.status,
      dct.due_at,
      dct.completed_at,
      dct.notes,
      dct.updated_at
    FROM dealer_campaign_tasks dct
    JOIN dealer_campaigns dc ON dc.id = dct.campaign_id
    JOIN dealers d ON d.id = dct.dealer_id
    LEFT JOIN dealer_displays dd ON dd.id = dct.dealer_display_id
    LEFT JOIN dealer_display_types ddt ON ddt.id = dd.display_type_id
    ${where}
    ORDER BY dct.status, d.name, ddt.display_name, dct.task_type
    LIMIT $${index}`,
    [...params, limit]
  );

  return { count: result.rowCount ?? 0, tasks: result.rows };
}

export async function updateCampaignTask(input: UpdateCampaignTaskInput): Promise<Record<string, unknown> | null> {
  let taskId = input.task_id;

  if (!taskId) {
    if (!input.campaign_name || !input.task_type || (!input.dealer_search && !input.account_number)) {
      throw new Error('task_id or campaign_name + task_type + dealer_search/account_number is required');
    }

    const dealer = await findDealer({
      account_number: input.account_number,
      dealer_search: input.dealer_search,
    });
    if (!dealer) throw new Error(`Dealer not found: ${input.account_number || input.dealer_search}`);

    const params: unknown[] = [normalizeKey(input.campaign_name), dealer.id, input.task_type];
    let displayJoin = '';
    let displayCondition = '';
    if (input.display_code) {
      params.push(normalizeKey(input.display_code));
      displayJoin = 'JOIN dealer_displays dd ON dd.id = dct.dealer_display_id JOIN dealer_display_types ddt ON ddt.id = dd.display_type_id';
      displayCondition = `AND ddt.code = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT dct.id
       FROM dealer_campaign_tasks dct
       JOIN dealer_campaigns dc ON dc.id = dct.campaign_id
       ${displayJoin}
       WHERE dc.normalized_name = $1
         AND dct.dealer_id = $2
         AND dct.task_type = $3
         ${displayCondition}
       ORDER BY dct.created_at DESC
       LIMIT 1`,
      params
    );
    taskId = result.rows[0]?.id;
  }

  if (!taskId) return null;

  const result = await pool.query(
    `UPDATE dealer_campaign_tasks
     SET status = $2,
       notes = COALESCE($3, notes),
       completed_at = CASE WHEN $2 = 'done' THEN NOW() ELSE completed_at END,
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [taskId, input.status, input.notes ?? null]
  );
  return result.rows[0] ?? null;
}

export async function recordCampaignSale(input: RecordCampaignSaleInput): Promise<Record<string, unknown>> {
  const campaign = await getCampaignByName(input.campaign_name);
  if (!campaign) throw new Error(`Campaign not found: ${input.campaign_name}`);

  const dealer = await findDealer({
    account_number: input.account_number,
    dealer_search: input.dealer_search,
  });
  if (!dealer) throw new Error(`Dealer not found: ${input.account_number || input.dealer_search}`);

  const itemParams: unknown[] = [campaign.id, normalizeKey(input.item_name)];
  let manufacturerCondition = '';
  if (input.manufacturer) {
    itemParams.push(input.manufacturer);
    manufacturerCondition = `AND LOWER(manufacturer) = LOWER($${itemParams.length})`;
  }

  const itemResult = await pool.query(
    `SELECT * FROM dealer_campaign_items
     WHERE campaign_id = $1
       AND normalized_item_name = $2
       ${manufacturerCondition}
       AND is_active = TRUE
     ORDER BY manufacturer NULLS LAST
     LIMIT 1`,
    itemParams
  );
  const item = itemResult.rows[0];
  if (!item) throw new Error(`Campaign item not found: ${input.item_name}`);

  const pointsEarned = Number(input.quantity) * Number(item.point_value ?? 0);
  const result = await pool.query(
    `INSERT INTO dealer_campaign_entries (
      campaign_id, dealer_id, campaign_item_id, entry_type, entry_date,
      quantity, value, cost, profit, points_earned, notes, metadata
    )
    VALUES ($1, $2, $3, 'sale', $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *`,
    [
      campaign.id,
      dealer.id,
      item.id,
      input.entry_date ?? new Date().toISOString().slice(0, 10),
      input.quantity,
      input.value ?? null,
      input.cost ?? null,
      input.profit ?? null,
      pointsEarned,
      input.notes ?? null,
      JSON.stringify({
        manufacturer: item.manufacturer,
        item_name: item.item_name,
        point_value: item.point_value,
      }),
    ]
  );

  return {
    entry: result.rows[0],
    dealer,
    item: {
      id: item.id,
      manufacturer: item.manufacturer,
      item_name: item.item_name,
      point_value: item.point_value,
    },
    points_earned: pointsEarned,
  };
}

export async function campaignReport(input: CampaignReportInput): Promise<Record<string, unknown>> {
  const campaign = await getCampaignByName(input.campaign_name);
  if (!campaign) throw new Error(`Campaign not found: ${input.campaign_name}`);

  const taskSummary = await pool.query(
    `SELECT status, task_type, COUNT(*)::int AS count
     FROM dealer_campaign_tasks
     WHERE campaign_id = $1
     GROUP BY status, task_type
     ORDER BY task_type, status`,
    [campaign.id]
  );

  const entrySummary = await pool.query(
    `SELECT
      COALESCE(dci.manufacturer, 'Unspecified') AS manufacturer,
      dci.item_name,
      SUM(dce.quantity)::float AS quantity,
      SUM(dce.points_earned)::float AS points_earned,
      COUNT(*)::int AS entries
    FROM dealer_campaign_entries dce
    LEFT JOIN dealer_campaign_items dci ON dci.id = dce.campaign_item_id
    WHERE dce.campaign_id = $1
      AND dce.status != 'void'
    GROUP BY dci.manufacturer, dci.item_name
    ORDER BY points_earned DESC NULLS LAST, quantity DESC NULLS LAST
    LIMIT $2`,
    [campaign.id, input.limit ?? 50]
  );

  const dealerSummary = await pool.query(
    `SELECT
      d.account_number,
      d.name AS dealer_name,
      SUM(dce.quantity)::float AS quantity,
      SUM(dce.points_earned)::float AS points_earned,
      COUNT(*)::int AS entries
    FROM dealer_campaign_entries dce
    JOIN dealers d ON d.id = dce.dealer_id
    WHERE dce.campaign_id = $1
      AND dce.status != 'void'
    GROUP BY d.account_number, d.name
    ORDER BY points_earned DESC NULLS LAST, quantity DESC NULLS LAST
    LIMIT $2`,
    [campaign.id, input.limit ?? 50]
  );

  return {
    campaign,
    task_summary: taskSummary.rows,
    item_entry_summary: entrySummary.rows,
    dealer_entry_summary: dealerSummary.rows,
  };
}
