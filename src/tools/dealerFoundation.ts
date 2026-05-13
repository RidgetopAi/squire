/**
 * Durable dealer foundation tools.
 *
 * These tools sit above the canonical dealers table and support flexible
 * dealer-linked campaigns such as display updates, PK training, sundry sales,
 * point contests, and monthly reports.
 */

import {
  campaignReport,
  createDealerCampaign,
  dealerFoundationSummary,
  generateDisplayCampaignTasks,
  importCampaignItemsFromCsv,
  importDealerFoundation,
  importSalesReport,
  queryDealerFoundation,
  queryCampaignTasks,
  recordCampaignSale,
  updateCampaignTask,
} from '../services/business/dealerFoundation.js';
import type { ToolHandler, ToolSpec } from './types.js';

interface ImportDealerFoundationArgs {
  directory: string;
  deactivate_missing_displays?: boolean;
  deactivate_missing_programs?: boolean;
  include_sales_example?: boolean;
  sales_period_start?: string;
  sales_period_end?: string;
}

async function handleImportDealerFoundation(args: ImportDealerFoundationArgs): Promise<string> {
  if (!args.directory) {
    return JSON.stringify({ error: 'directory is required' });
  }

  try {
    const result = await importDealerFoundation({
      directory: args.directory,
      deactivateMissingDisplays: args.deactivate_missing_displays,
      deactivateMissingPrograms: args.deactivate_missing_programs,
      includeSalesExample: args.include_sales_example,
      salesPeriodStart: args.sales_period_start,
      salesPeriodEnd: args.sales_period_end,
    });
    return JSON.stringify({
      message: 'Dealer foundation import completed',
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Dealer foundation import failed: ${message}` });
  }
}

interface ImportDealerSalesReportArgs {
  file_path: string;
  period_start: string;
  period_end: string;
}

async function handleImportDealerSalesReport(args: ImportDealerSalesReportArgs): Promise<string> {
  if (!args.file_path || !args.period_start || !args.period_end) {
    return JSON.stringify({ error: 'file_path, period_start, and period_end are required' });
  }

  try {
    const result = await importSalesReport(args.file_path, args.period_start, args.period_end);
    return JSON.stringify({
      message: 'Dealer sales report imported',
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Sales report import failed: ${message}` });
  }
}

interface CreateDealerCampaignArgs {
  name: string;
  campaign_type?: string;
  status?: string;
  period_start?: string;
  period_end?: string;
  point_rule?: string;
  metadata?: Record<string, unknown>;
}

async function handleCreateDealerCampaign(args: CreateDealerCampaignArgs): Promise<string> {
  if (!args.name) {
    return JSON.stringify({ error: 'name is required' });
  }

  try {
    const campaign = await createDealerCampaign(args);
    return JSON.stringify({
      message: 'Dealer campaign saved',
      campaign,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Campaign creation failed: ${message}` });
  }
}

interface ImportCampaignItemsArgs {
  campaign_name: string;
  file_path: string;
}

async function handleImportCampaignItems(args: ImportCampaignItemsArgs): Promise<string> {
  if (!args.campaign_name || !args.file_path) {
    return JSON.stringify({ error: 'campaign_name and file_path are required' });
  }

  try {
    const result = await importCampaignItemsFromCsv(args.campaign_name, args.file_path);
    return JSON.stringify({
      message: 'Campaign item catalog imported',
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Campaign item import failed: ${message}` });
  }
}

interface GenerateDisplayCampaignTasksArgs {
  campaign_name: string;
  display_codes?: string[];
  task_types: string[];
  due_at?: string;
  status?: string;
}

async function handleGenerateDisplayCampaignTasks(args: GenerateDisplayCampaignTasksArgs): Promise<string> {
  if (!args.campaign_name || !args.task_types || args.task_types.length === 0) {
    return JSON.stringify({ error: 'campaign_name and at least one task_type are required' });
  }

  try {
    const result = await generateDisplayCampaignTasks({
      campaign_name: args.campaign_name,
      display_codes: args.display_codes,
      task_types: args.task_types,
      due_at: args.due_at,
      status: args.status,
    });
    return JSON.stringify({
      message: 'Display campaign tasks generated',
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Task generation failed: ${message}` });
  }
}

interface QueryDealerCampaignTasksArgs {
  campaign_name?: string;
  dealer_search?: string;
  display_code?: string;
  task_type?: string;
  status?: string;
  limit?: number;
}

async function handleQueryDealerCampaignTasks(args: QueryDealerCampaignTasksArgs): Promise<string> {
  try {
    const result = await queryCampaignTasks(args);
    return JSON.stringify(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Campaign task query failed: ${message}` });
  }
}

interface UpdateDealerCampaignTaskArgs {
  task_id?: string;
  campaign_name?: string;
  dealer_search?: string;
  account_number?: string;
  display_code?: string;
  task_type?: string;
  status: string;
  notes?: string | null;
}

async function handleUpdateDealerCampaignTask(args: UpdateDealerCampaignTaskArgs): Promise<string> {
  if (!args.status) {
    return JSON.stringify({ error: 'status is required' });
  }

  try {
    const task = await updateCampaignTask(args);
    if (!task) {
      return JSON.stringify({ error: 'No matching campaign task found' });
    }
    return JSON.stringify({
      message: 'Campaign task updated',
      task,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Campaign task update failed: ${message}` });
  }
}

interface RecordDealerCampaignSaleArgs {
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

async function handleRecordDealerCampaignSale(args: RecordDealerCampaignSaleArgs): Promise<string> {
  if (!args.campaign_name || !args.item_name || args.quantity === undefined) {
    return JSON.stringify({ error: 'campaign_name, item_name, and quantity are required' });
  }
  if (!args.dealer_search && !args.account_number) {
    return JSON.stringify({ error: 'dealer_search or account_number is required' });
  }

  try {
    const result = await recordCampaignSale(args);
    return JSON.stringify({
      message: 'Campaign sale recorded',
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Campaign sale record failed: ${message}` });
  }
}

interface DealerCampaignReportArgs {
  campaign_name: string;
  limit?: number;
}

async function handleDealerCampaignReport(args: DealerCampaignReportArgs): Promise<string> {
  if (!args.campaign_name) {
    return JSON.stringify({ error: 'campaign_name is required' });
  }

  try {
    const result = await campaignReport(args);
    return JSON.stringify(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Campaign report failed: ${message}` });
  }
}

interface QueryDealerFoundationArgs {
  dealer_search?: string;
  display_code?: string;
  program_name?: string;
  limit?: number;
}

async function handleQueryDealerFoundation(args: QueryDealerFoundationArgs): Promise<string> {
  try {
    const result = await queryDealerFoundation(args);
    return JSON.stringify(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Dealer foundation query failed: ${message}` });
  }
}

async function handleDealerFoundationSummary(): Promise<string> {
  try {
    const result = await dealerFoundationSummary();
    return JSON.stringify(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Dealer foundation summary failed: ${message}` });
  }
}

export const tools: ToolSpec[] = [
  {
    name: 'dealer_foundation_summary',
    description:
      'Get the current durable dealer foundation summary: active dealer count, display mappings, program memberships, visible campaigns, and campaign task counts. This is the source of truth for dealer/display foundation status.',
    parameters: {
      type: 'object',
      properties: {},
    },
    handler: handleDealerFoundationSummary as ToolHandler,
  },
  {
    name: 'query_dealer_foundation',
    description:
      'Query canonical dealers from the durable foundation by dealer name/account, active display code, or program membership. Use this instead of legacy dealer/display tools for questions like which dealers have Responsive displays, what displays a dealer has, or which dealers are in a program.',
    parameters: {
      type: 'object',
      properties: {
        dealer_search: {
          type: 'string',
          description: 'Dealer name, trade name, alias, or account number search.',
        },
        display_code: {
          type: 'string',
          description:
            'Optional display code filter such as responsive, lauzon_expert, lauzon_partner, bjelin, adura_pro, sar, somerset.',
        },
        program_name: {
          type: 'string',
          description: 'Optional dealer program filter, such as ADVANTAGE or DIRECT PLUS.',
        },
        limit: {
          type: 'number',
          description: 'Maximum dealers to return. Default 50.',
        },
      },
    },
    handler: handleQueryDealerFoundation as ToolHandler,
  },
  {
    name: 'import_dealer_foundation',
    description:
      'Import the durable dealer foundation from a directory containing master-dealer-list.csv, display roster CSVs, and program-dealers.csv. This creates/updates canonical dealers, dealer aliases, display footprint, and program memberships.',
    parameters: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'Directory containing the raw CSV files, such as /home/ridgetop/projects/squire/raw-csv',
        },
        deactivate_missing_displays: {
          type: 'boolean',
          description:
            'When true, each display roster is treated as authoritative and active displays missing from that roster are marked inactive. Default false.',
        },
        deactivate_missing_programs: {
          type: 'boolean',
          description:
            'When true, program-dealers.csv is treated as authoritative and missing active memberships are marked inactive. Default false.',
        },
        include_sales_example: {
          type: 'boolean',
          description:
            'Whether to import sales-report-example.csv. Usually false because that file is only a structure example unless Brian provides a period.',
        },
        sales_period_start: {
          type: 'string',
          description: 'YYYY-MM-DD period start for sales-report-example.csv when include_sales_example is true.',
        },
        sales_period_end: {
          type: 'string',
          description: 'YYYY-MM-DD period end for sales-report-example.csv when include_sales_example is true.',
        },
      },
      required: ['directory'],
    },
    handler: handleImportDealerFoundation as ToolHandler,
  },
  {
    name: 'import_dealer_sales_report',
    description:
      'Import a monthly or partial-month dealer sales report by product category. Reuploads for the same dealer/category/period update the existing row instead of duplicating it.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Full path to the sales report CSV.',
        },
        period_start: {
          type: 'string',
          description: 'Report period start date in YYYY-MM-DD format.',
        },
        period_end: {
          type: 'string',
          description: 'Report period end date in YYYY-MM-DD format.',
        },
      },
      required: ['file_path', 'period_start', 'period_end'],
    },
    handler: handleImportDealerSalesReport as ToolHandler,
  },
  {
    name: 'create_dealer_campaign',
    description:
      'Create or update a flexible dealer-linked campaign/tracker. Use for display updates, PK training, sundry sales contests, point promos, program pushes, and other dealer goals without creating new database tables.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Campaign name, such as June Sundry Sale or 2026 Responsive/Lauzon Display Updates.',
        },
        campaign_type: {
          type: 'string',
          enum: ['display_update', 'training', 'sales_contest', 'item_promo', 'program', 'general'],
          description: 'Campaign category. Default general.',
        },
        status: {
          type: 'string',
          enum: ['draft', 'active', 'paused', 'completed', 'archived'],
          description: 'Campaign status. Default active.',
        },
        period_start: {
          type: 'string',
          description: 'Optional campaign start date in YYYY-MM-DD format.',
        },
        period_end: {
          type: 'string',
          description: 'Optional campaign end date in YYYY-MM-DD format.',
        },
        point_rule: {
          type: 'string',
          description: 'Human-readable point rule or scoring note.',
        },
        metadata: {
          type: 'object',
          description: 'Optional structured metadata for future campaign-specific needs.',
        },
      },
      required: ['name'],
    },
    handler: handleCreateDealerCampaign as ToolHandler,
  },
  {
    name: 'import_dealer_campaign_items',
    description:
      'Import an item catalog for a dealer campaign from CSV. Expected columns can include manufacturer, item, point_value, unit, sku, and category. Useful for sundry promos where each sold item earns points.',
    parameters: {
      type: 'object',
      properties: {
        campaign_name: {
          type: 'string',
          description: 'Existing campaign name.',
        },
        file_path: {
          type: 'string',
          description: 'Full path to the item catalog CSV.',
        },
      },
      required: ['campaign_name', 'file_path'],
    },
    handler: handleImportCampaignItems as ToolHandler,
  },
  {
    name: 'generate_display_campaign_tasks',
    description:
      'Generate per-display campaign tasks for every active matching dealer display. Use this for tasks like display_update and pk_training where a dealer with Responsive and Lauzon should get separate tasks for each display.',
    parameters: {
      type: 'object',
      properties: {
        campaign_name: {
          type: 'string',
          description: 'Existing campaign name.',
        },
        display_codes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional display codes such as responsive, lauzon_expert, lauzon_partner. If omitted, all active displays are targeted.',
        },
        task_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task types to create, such as display_update and pk_training.',
        },
        due_at: {
          type: 'string',
          description: 'Optional due date/time.',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done', 'skipped', 'cancelled'],
          description: 'Initial task status. Default pending.',
        },
      },
      required: ['campaign_name', 'task_types'],
    },
    handler: handleGenerateDisplayCampaignTasks as ToolHandler,
  },
  {
    name: 'query_dealer_campaign_tasks',
    description:
      'Query dealer campaign tasks by campaign, dealer, display, task type, and status. Use for reports like Responsive PK training still pending or Lauzon display updates done.',
    parameters: {
      type: 'object',
      properties: {
        campaign_name: { type: 'string' },
        dealer_search: { type: 'string' },
        display_code: { type: 'string' },
        task_type: { type: 'string' },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done', 'skipped', 'cancelled'],
        },
        limit: { type: 'number' },
      },
    },
    handler: handleQueryDealerCampaignTasks as ToolHandler,
  },
  {
    name: 'update_dealer_campaign_task',
    description:
      'Update a dealer campaign task by task_id or by campaign + dealer + display + task_type. Supports natural-language updates like marking a dealer display PK training done.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        campaign_name: { type: 'string' },
        dealer_search: { type: 'string' },
        account_number: { type: 'string' },
        display_code: { type: 'string' },
        task_type: { type: 'string' },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done', 'skipped', 'cancelled'],
        },
        notes: { type: 'string' },
      },
      required: ['status'],
    },
    handler: handleUpdateDealerCampaignTask as ToolHandler,
  },
  {
    name: 'record_dealer_campaign_sale',
    description:
      'Record an item sale against a dealer campaign and calculate earned points from the campaign item catalog. Use for promos like June Sundry Sale.',
    parameters: {
      type: 'object',
      properties: {
        campaign_name: { type: 'string' },
        dealer_search: { type: 'string' },
        account_number: { type: 'string' },
        manufacturer: { type: 'string' },
        item_name: { type: 'string' },
        quantity: { type: 'number' },
        entry_date: {
          type: 'string',
          description: 'Optional sale date in YYYY-MM-DD format.',
        },
        value: { type: 'number' },
        cost: { type: 'number' },
        profit: { type: 'number' },
        notes: { type: 'string' },
      },
      required: ['campaign_name', 'item_name', 'quantity'],
    },
    handler: handleRecordDealerCampaignSale as ToolHandler,
  },
  {
    name: 'dealer_campaign_report',
    description:
      'Generate a structured campaign report including task status breakdowns, item totals, dealer totals, quantities, and points.',
    parameters: {
      type: 'object',
      properties: {
        campaign_name: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['campaign_name'],
    },
    handler: handleDealerCampaignReport as ToolHandler,
  },
];
