-- Durable dealer foundation and flexible campaign tracking
--
-- Keeps dealers as the canonical account table while adding normalized
-- companion tables for aliases, displays, programs, sales history, and
-- reusable campaigns.

ALTER TABLE dealers ADD COLUMN IF NOT EXISTS normalized_name TEXT;
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS address_line1 TEXT;
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS address_line2 TEXT;
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS address_line3 TEXT;
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS address_line4 TEXT;
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS country VARCHAR(50);
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dealers_normalized_name ON dealers (normalized_name);

CREATE TABLE IF NOT EXISTS dealer_data_imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_type VARCHAR(50) NOT NULL,
  filename TEXT,
  source VARCHAR(100) DEFAULT 'csv',
  source_hash TEXT,
  period_start DATE,
  period_end DATE,
  row_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'completed',
  errors INTEGER NOT NULL DEFAULT 0,
  error_details TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT dealer_data_imports_type_check CHECK (import_type IN (
    'dealer_master',
    'display_roster',
    'program_membership',
    'sales_report',
    'campaign_catalog',
    'campaign_activity'
  )),
  CONSTRAINT dealer_data_imports_status_check CHECK (status IN (
    'processing',
    'completed',
    'failed',
    'skipped_duplicate'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dealer_data_imports_hash
  ON dealer_data_imports (source_hash)
  WHERE source_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dealer_data_imports_type_date
  ON dealer_data_imports (import_type, imported_at DESC);

CREATE TABLE IF NOT EXISTS dealer_aliases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  alias_name TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  alias_type VARCHAR(30) NOT NULL DEFAULT 'source_name',
  source VARCHAR(100),
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 1.0,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dealer_aliases_type_check CHECK (alias_type IN (
    'account_name',
    'trade_name',
    'source_name',
    'account_number',
    'manual'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dealer_aliases_dealer_alias
  ON dealer_aliases (dealer_id, normalized_alias);

CREATE INDEX IF NOT EXISTS idx_dealer_aliases_normalized
  ON dealer_aliases (normalized_alias);

CREATE TABLE IF NOT EXISTS dealer_display_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(80) NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  vendor TEXT,
  category TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dealer_displays (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  display_type_id UUID NOT NULL REFERENCES dealer_display_types(id) ON DELETE RESTRICT,
  source_import_id UUID REFERENCES dealer_data_imports(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dealer_displays_unique
  ON dealer_displays (dealer_id, display_type_id);

CREATE INDEX IF NOT EXISTS idx_dealer_displays_dealer
  ON dealer_displays (dealer_id);

CREATE INDEX IF NOT EXISTS idx_dealer_displays_type
  ON dealer_displays (display_type_id, active);

CREATE TABLE IF NOT EXISTS dealer_program_memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  program_name TEXT NOT NULL,
  normalized_program_name TEXT NOT NULL,
  source_import_id UUID REFERENCES dealer_data_imports(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dealer_program_unique
  ON dealer_program_memberships (dealer_id, normalized_program_name);

CREATE INDEX IF NOT EXISTS idx_dealer_program_name
  ON dealer_program_memberships (normalized_program_name, active);

CREATE TABLE IF NOT EXISTS dealer_sales_by_category (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  import_id UUID REFERENCES dealer_data_imports(id) ON DELETE SET NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  product_category TEXT NOT NULL,
  value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  cost NUMERIC(14, 2) NOT NULL DEFAULT 0,
  profit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  gross_profit_percent NUMERIC(8, 4),
  avg_price NUMERIC(14, 4),
  quantity NUMERIC(14, 4) NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  source_row_hash TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dealer_sales_period_category_unique
  ON dealer_sales_by_category (dealer_id, product_category, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_dealer_sales_dealer_period
  ON dealer_sales_by_category (dealer_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_dealer_sales_category_period
  ON dealer_sales_by_category (product_category, period_start, period_end);

CREATE TABLE IF NOT EXISTS dealer_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  campaign_type VARCHAR(50) NOT NULL DEFAULT 'general',
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  period_start DATE,
  period_end DATE,
  point_rule TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dealer_campaigns_type_check CHECK (campaign_type IN (
    'display_update',
    'training',
    'sales_contest',
    'item_promo',
    'program',
    'general'
  )),
  CONSTRAINT dealer_campaigns_status_check CHECK (status IN (
    'draft',
    'active',
    'paused',
    'completed',
    'archived'
  ))
);

CREATE INDEX IF NOT EXISTS idx_dealer_campaigns_status
  ON dealer_campaigns (status, period_start);

CREATE TABLE IF NOT EXISTS dealer_campaign_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES dealer_campaigns(id) ON DELETE CASCADE,
  manufacturer TEXT,
  item_name TEXT NOT NULL,
  normalized_item_name TEXT NOT NULL,
  item_sku TEXT,
  product_category TEXT,
  unit TEXT,
  point_value NUMERIC(12, 4) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dealer_campaign_items_unique
  ON dealer_campaign_items (
    campaign_id,
    COALESCE(manufacturer, ''),
    normalized_item_name,
    COALESCE(item_sku, '')
  );

CREATE INDEX IF NOT EXISTS idx_dealer_campaign_items_campaign
  ON dealer_campaign_items (campaign_id, is_active);

CREATE TABLE IF NOT EXISTS dealer_campaign_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES dealer_campaigns(id) ON DELETE CASCADE,
  dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  dealer_display_id UUID REFERENCES dealer_displays(id) ON DELETE CASCADE,
  campaign_item_id UUID REFERENCES dealer_campaign_items(id) ON DELETE SET NULL,
  task_type VARCHAR(80) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 3,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  source_import_id UUID REFERENCES dealer_data_imports(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dealer_campaign_tasks_status_check CHECK (status IN (
    'pending',
    'in_progress',
    'done',
    'skipped',
    'cancelled'
  )),
  CONSTRAINT dealer_campaign_tasks_priority_check CHECK (priority BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dealer_campaign_tasks_unique
  ON dealer_campaign_tasks (
    campaign_id,
    dealer_id,
    COALESCE(dealer_display_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(campaign_item_id, '00000000-0000-0000-0000-000000000000'::uuid),
    task_type
  );

CREATE INDEX IF NOT EXISTS idx_dealer_campaign_tasks_campaign_status
  ON dealer_campaign_tasks (campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_dealer_campaign_tasks_dealer
  ON dealer_campaign_tasks (dealer_id, status);

CREATE TABLE IF NOT EXISTS dealer_campaign_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES dealer_campaigns(id) ON DELETE CASCADE,
  dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  campaign_item_id UUID REFERENCES dealer_campaign_items(id) ON DELETE SET NULL,
  dealer_display_id UUID REFERENCES dealer_displays(id) ON DELETE SET NULL,
  entry_type VARCHAR(40) NOT NULL DEFAULT 'activity',
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  quantity NUMERIC(14, 4) NOT NULL DEFAULT 0,
  value NUMERIC(14, 2),
  cost NUMERIC(14, 2),
  profit NUMERIC(14, 2),
  points_earned NUMERIC(14, 4) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'logged',
  notes TEXT,
  source_import_id UUID REFERENCES dealer_data_imports(id) ON DELETE SET NULL,
  source_row_hash TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dealer_campaign_entries_type_check CHECK (entry_type IN (
    'sale',
    'activity',
    'progress',
    'adjustment'
  )),
  CONSTRAINT dealer_campaign_entries_status_check CHECK (status IN (
    'logged',
    'verified',
    'void'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dealer_campaign_entries_source_unique
  ON dealer_campaign_entries (source_import_id, source_row_hash)
  WHERE source_import_id IS NOT NULL AND source_row_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dealer_campaign_entries_campaign_dealer
  ON dealer_campaign_entries (campaign_id, dealer_id, entry_date);

CREATE INDEX IF NOT EXISTS idx_dealer_campaign_entries_item
  ON dealer_campaign_entries (campaign_item_id, entry_date);

COMMENT ON TABLE dealer_aliases IS 'Names and source aliases that resolve back to canonical dealers';
COMMENT ON TABLE dealer_displays IS 'Current and historical display/program footprint by dealer';
COMMENT ON TABLE dealer_campaigns IS 'Reusable dealer-linked trackers, contests, promos, and work campaigns';
COMMENT ON TABLE dealer_campaign_tasks IS 'Per dealer or per dealer-display work items such as display updates and PK training';
COMMENT ON TABLE dealer_campaign_entries IS 'Logged campaign activity such as sundry item sales and point earning events';
