/**
 * Dealer Display Tools
 *
 * LLM tools for importing, querying, and managing dealer display tracking.
 */

import * as fs from 'fs/promises';
import {
  importFromCsv,
  queryDealers,
  getDealerByAccount,
  searchDealersByName,
  getDisplayWorkByDealer,
  queryDisplayWork,
  updateDisplayWorkStatus,
  getDealerSummary,
  getImportHistory,
  exportToCsv,
  getDealersWithWork,
} from '../services/business/dealers.js';
import type { ToolHandler, ToolSpec } from './types.js';

// =============================================================================
// IMPORT DEALERS TOOL
// =============================================================================

interface ImportDealersArgs {
  file_path: string;
  filename?: string;
}

async function handleImportDealers(args: ImportDealersArgs): Promise<string> {
  const { file_path, filename } = args;

  if (!file_path) {
    return JSON.stringify({ error: 'file_path is required' });
  }

  try {
    // Read file
    const content = await fs.readFile(file_path, 'utf-8');

    // Import
    const result = await importFromCsv(content, {
      filename: filename || file_path.split('/').pop(),
      source: 'csv',
    });

    return JSON.stringify({
      message: `Import completed successfully`,
      import_id: result.import_id,
      stats: {
        total_rows: result.total_rows,
        dealers_created: result.dealers_created,
        dealers_updated: result.dealers_updated,
        work_items_created: result.work_items_created,
        work_items_updated: result.work_items_updated,
        errors: result.errors,
      },
      error_details:
        result.errors > 0 ? result.error_details.slice(0, 5) : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Import failed: ${message}` });
  }
}

// =============================================================================
// QUERY DEALERS TOOL
// =============================================================================

interface QueryDealersArgs {
  manufacturer?: 'responsive' | 'lauzon' | 'both';
  rep_name?: string;
  city?: string;
  state?: string;
  search?: string;
  limit?: number;
}

async function handleQueryDealers(args: QueryDealersArgs): Promise<string> {
  try {
    const result = await queryDealers({
      manufacturer: args.manufacturer,
      rep_name: args.rep_name,
      city: args.city,
      state: args.state,
      search: args.search,
      limit: args.limit || 50,
    });

    if (result.dealers.length === 0) {
      return JSON.stringify({
        message: 'No dealers found matching the criteria',
        total: 0,
        dealers: [],
      });
    }

    const dealers = result.dealers.map((d) => ({
      id: d.id,
      account_number: d.account_number,
      name: d.name,
      trade_name: d.trade_name,
      rep_name: d.rep_name,
      city: d.city,
      state: d.state,
      has_responsive: d.has_responsive,
      has_lauzon: d.has_lauzon,
    }));

    return JSON.stringify({
      total: result.total,
      returned: dealers.length,
      dealers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Query failed: ${message}` });
  }
}

// =============================================================================
// GET DEALER TOOL
// =============================================================================

interface GetDealerArgs {
  account_number?: string;
  search?: string;
}

async function handleGetDealer(args: GetDealerArgs): Promise<string> {
  try {
    let dealer = null;

    if (args.account_number) {
      dealer = await getDealerByAccount(args.account_number);
    } else if (args.search) {
      const dealers = await searchDealersByName(args.search);
      if (dealers.length > 0) {
        dealer = dealers[0];
      }
    } else {
      return JSON.stringify({
        error: 'Either account_number or search is required',
      });
    }

    if (!dealer) {
      return JSON.stringify({
        error: 'Dealer not found',
        searched_for: args.account_number || args.search,
      });
    }

    // Get display work for this dealer
    const displayWork = await getDisplayWorkByDealer(dealer.id);

    return JSON.stringify({
      dealer: {
        id: dealer.id,
        account_number: dealer.account_number,
        name: dealer.name,
        trade_name: dealer.trade_name,
        rep_name: dealer.rep_name,
        address: dealer.address,
        city: dealer.city,
        state: dealer.state,
        zip: dealer.zip,
        has_responsive: dealer.has_responsive,
        has_lauzon: dealer.has_lauzon,
        manufacturer_code: dealer.manufacturer_code,
      },
      display_work: displayWork.map((w) => ({
        id: w.id,
        manufacturer: w.manufacturer,
        display_type: w.display_type,
        quantity: w.quantity,
        sales_amount: w.sales_amount,
        sales_period: w.sales_period,
        status: w.status,
        notes: w.notes,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to get dealer: ${message}` });
  }
}

// =============================================================================
// QUERY DISPLAY WORK TOOL
// =============================================================================

interface QueryDisplayWorkArgs {
  manufacturer?: string;
  display_type?: string;
  status?: string;
  min_quantity?: number;
  limit?: number;
}

async function handleQueryDisplayWork(
  args: QueryDisplayWorkArgs
): Promise<string> {
  try {
    const result = await queryDisplayWork({
      manufacturer: args.manufacturer,
      display_type: args.display_type,
      status: args.status,
      min_quantity: args.min_quantity,
      limit: args.limit || 50,
    });

    if (result.items.length === 0) {
      return JSON.stringify({
        message: 'No display work items found matching the criteria',
        total: 0,
        items: [],
      });
    }

    // Map work items
    const items = result.items.map((w) => ({
      id: w.id,
      dealer_id: w.dealer_id,
      manufacturer: w.manufacturer,
      display_type: w.display_type,
      quantity: w.quantity,
      sales_amount: w.sales_amount,
      sales_period: w.sales_period,
      status: w.status,
    }));

    return JSON.stringify({
      total: result.total,
      returned: items.length,
      items,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Query failed: ${message}` });
  }
}

// =============================================================================
// UPDATE DISPLAY WORK STATUS TOOL
// =============================================================================

interface UpdateDisplayWorkArgs {
  work_id: string;
  status: string;
  notes?: string;
}

async function handleUpdateDisplayWork(
  args: UpdateDisplayWorkArgs
): Promise<string> {
  if (!args.work_id) {
    return JSON.stringify({ error: 'work_id is required' });
  }
  if (!args.status) {
    return JSON.stringify({ error: 'status is required' });
  }

  try {
    const result = await updateDisplayWorkStatus(
      args.work_id,
      args.status,
      args.notes
    );

    if (!result) {
      return JSON.stringify({ error: 'Display work item not found' });
    }

    return JSON.stringify({
      message: 'Display work status updated',
      work: {
        id: result.id,
        manufacturer: result.manufacturer,
        display_type: result.display_type,
        quantity: result.quantity,
        status: result.status,
        notes: result.notes,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Update failed: ${message}` });
  }
}

// =============================================================================
// DEALER SUMMARY TOOL
// =============================================================================

async function handleDealerSummary(): Promise<string> {
  try {
    const summary = await getDealerSummary();

    return JSON.stringify({
      dealers: {
        total: summary.total_dealers,
        responsive: summary.responsive_dealers,
        lauzon: summary.lauzon_dealers,
        both_programs: summary.both_dealers,
      },
      display_work: {
        total_items: summary.total_display_items,
        by_manufacturer: summary.by_manufacturer,
        by_display_type: summary.by_display_type,
        by_status: summary.by_status,
      },
      sales: {
        responsive_2025: summary.total_sales.responsive,
        lauzon_2025: summary.total_sales.lauzon,
        total: summary.total_sales.responsive + summary.total_sales.lauzon,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to get summary: ${message}` });
  }
}

// =============================================================================
// IMPORT HISTORY TOOL
// =============================================================================

interface ImportHistoryArgs {
  limit?: number;
}

async function handleImportHistory(args: ImportHistoryArgs): Promise<string> {
  try {
    const history = await getImportHistory(args.limit || 10);

    if (history.length === 0) {
      return JSON.stringify({
        message: 'No import history found',
        imports: [],
      });
    }

    const imports = history.map((i) => ({
      id: i.id,
      filename: i.filename,
      imported_at: i.imported_at,
      status: i.status,
      total_rows: i.total_rows,
      dealers_created: i.dealers_created,
      dealers_updated: i.dealers_updated,
      work_items_created: i.work_items_created,
      errors: i.errors,
    }));

    return JSON.stringify({
      count: imports.length,
      imports,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to get history: ${message}` });
  }
}

// =============================================================================
// EXPORT DEALERS TOOL
// =============================================================================

interface ExportDealersArgs {
  manufacturer?: string;
  output_path?: string;
}

async function handleExportDealers(args: ExportDealersArgs): Promise<string> {
  try {
    const csvContent = await exportToCsv(args.manufacturer);

    if (args.output_path) {
      await fs.writeFile(args.output_path, csvContent, 'utf-8');
      return JSON.stringify({
        message: `Exported to ${args.output_path}`,
        rows: csvContent.split('\n').length - 1,
      });
    }

    // Return CSV content directly (truncated if large)
    const lines = csvContent.split('\n');
    if (lines.length > 50) {
      return JSON.stringify({
        message: `Export ready (${lines.length - 1} rows). Specify output_path to save to file.`,
        preview: lines.slice(0, 20).join('\n'),
        total_rows: lines.length - 1,
      });
    }

    return JSON.stringify({
      csv: csvContent,
      rows: lines.length - 1,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Export failed: ${message}` });
  }
}

// =============================================================================
// DEALER OBLIGATIONS TOOL (combined view)
// =============================================================================

interface DealerObligationsArgs {
  manufacturer?: 'responsive' | 'lauzon';
  limit?: number;
}

async function handleDealerObligations(
  args: DealerObligationsArgs
): Promise<string> {
  try {
    const dealers = await getDealersWithWork(args.manufacturer, args.limit || 25);

    if (dealers.length === 0) {
      return JSON.stringify({
        message: 'No dealers found with display obligations',
        dealers: [],
      });
    }

    const result = dealers.map((d) => ({
      account: d.account_number,
      name: d.name,
      trade_name: d.trade_name,
      rep: d.rep_name,
      location: `${d.city || ''}, ${d.state || ''}`.trim().replace(/^,\s*/, ''),
      obligations: d.display_work.map((w) => ({
        manufacturer: w.manufacturer,
        type: w.display_type,
        qty: w.quantity,
        sales: w.sales_amount,
        status: w.status,
      })),
    }));

    return JSON.stringify({
      count: result.length,
      dealers: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Query failed: ${message}` });
  }
}

// =============================================================================
// TOOL SPECS EXPORT
// =============================================================================

export const tools: ToolSpec[] = [
  {
    name: 'import_dealer_displays',
    description:
      'Import dealers and display obligations from a CSV file. Use this when Brian provides a CSV file with dealer/display data (e.g., responsive-lauzon-displays-brian.csv). The import will create/update dealer profiles and their display work items, preserving history across uploads.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description:
            'Full path to the CSV file to import (e.g., /opt/squire/responsive-lauzon-displays-brian.csv)',
        },
        filename: {
          type: 'string',
          description:
            'Optional friendly name for the import record (defaults to filename from path)',
        },
      },
      required: ['file_path'],
    },
    handler: handleImportDealers as ToolHandler,
  },
  {
    name: 'query_dealers',
    description:
      'Query dealers with filters. Use when Brian asks about dealers - "show me all Responsive dealers", "dealers in Virginia", "who does Brian Jones cover", etc.',
    parameters: {
      type: 'object',
      properties: {
        manufacturer: {
          type: 'string',
          enum: ['responsive', 'lauzon', 'both'],
          description:
            'Filter by manufacturer program: responsive, lauzon, or both (dealers in both programs)',
        },
        rep_name: {
          type: 'string',
          description: 'Filter by sales rep name (partial match)',
        },
        city: {
          type: 'string',
          description: 'Filter by city (exact match)',
        },
        state: {
          type: 'string',
          description: 'Filter by state abbreviation (e.g., VA, WV)',
        },
        search: {
          type: 'string',
          description:
            'Search dealers by name, trade name, or account number',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 50)',
        },
      },
    },
    handler: handleQueryDealers as ToolHandler,
  },
  {
    name: 'get_dealer',
    description:
      'Get detailed info for a specific dealer including all their display obligations. Use when Brian asks about a specific dealer by name or account number.',
    parameters: {
      type: 'object',
      properties: {
        account_number: {
          type: 'string',
          description: 'The dealer account number (e.g., WOOD111GAL)',
        },
        search: {
          type: 'string',
          description:
            'Search term to find dealer by name (if account number not known)',
        },
      },
    },
    handler: handleGetDealer as ToolHandler,
  },
  {
    name: 'query_display_work',
    description:
      'Query display work items across all dealers. Use when Brian asks about displays - "all Showcase displays", "pending Lauzon work", "displays with quantity > 2", etc.',
    parameters: {
      type: 'object',
      properties: {
        manufacturer: {
          type: 'string',
          description: 'Filter by manufacturer: responsive or lauzon',
        },
        display_type: {
          type: 'string',
          description:
            'Filter by display type (e.g., Showcase, Triple Tower, Pure Series)',
        },
        status: {
          type: 'string',
          description:
            'Filter by status: pending, in_progress, completed, cancelled',
        },
        min_quantity: {
          type: 'number',
          description: 'Filter for work items with at least this quantity',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 50)',
        },
      },
    },
    handler: handleQueryDisplayWork as ToolHandler,
  },
  {
    name: 'update_display_work',
    description:
      'Update the status or notes on a display work item. Use when Brian marks work as complete, in progress, or adds notes.',
    parameters: {
      type: 'object',
      properties: {
        work_id: {
          type: 'string',
          description: 'UUID of the display work item to update',
        },
        status: {
          type: 'string',
          description:
            'New status: pending, in_progress, completed, cancelled',
        },
        notes: {
          type: 'string',
          description: 'Optional notes to add',
        },
      },
      required: ['work_id', 'status'],
    },
    handler: handleUpdateDisplayWork as ToolHandler,
  },
  {
    name: 'dealer_display_summary',
    description:
      'Get aggregate summary of all dealers and display work. Use when Brian asks "how many dealers", "show me the summary", "what\'s the total sales", etc.',
    parameters: {
      type: 'object',
      properties: {},
    },
    handler: handleDealerSummary as ToolHandler,
  },
  {
    name: 'dealer_import_history',
    description:
      'Get the history of CSV imports. Use when Brian asks about past imports or wants to verify an import was successful.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of imports to show (default: 10)',
        },
      },
    },
    handler: handleImportHistory as ToolHandler,
  },
  {
    name: 'export_dealer_displays',
    description:
      'Export dealers and display work to CSV format. Use when Brian wants to export data or get a CSV dump.',
    parameters: {
      type: 'object',
      properties: {
        manufacturer: {
          type: 'string',
          description: 'Filter export by manufacturer: responsive or lauzon',
        },
        output_path: {
          type: 'string',
          description:
            'Path to write the CSV file. If not provided, returns CSV content.',
        },
      },
    },
    handler: handleExportDealers as ToolHandler,
  },
  {
    name: 'dealer_obligations',
    description:
      'Get dealers with their display obligations in a combined view. Good for understanding which dealers have which display requirements.',
    parameters: {
      type: 'object',
      properties: {
        manufacturer: {
          type: 'string',
          enum: ['responsive', 'lauzon'],
          description: 'Filter by manufacturer',
        },
        limit: {
          type: 'number',
          description: 'Maximum dealers to return (default: 25)',
        },
      },
    },
    handler: handleDealerObligations as ToolHandler,
  },
];
