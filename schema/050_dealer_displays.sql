-- Dealer Display Tracking System
-- Tracks dealer profiles, display obligations by manufacturer, and import history

-- Dealer profiles: durable backbone for dealer identity
CREATE TABLE IF NOT EXISTS dealers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Durable identity - account number is the backbone
  account_number VARCHAR(50) NOT NULL UNIQUE,

  -- Core info
  name VARCHAR(255) NOT NULL,
  trade_name VARCHAR(255),           -- T/A field from CSV

  -- Location
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(10),
  zip VARCHAR(20),

  -- Sales rep assignment
  rep_name VARCHAR(255),

  -- Manufacturer flags (which programs this dealer participates in)
  has_responsive BOOLEAN DEFAULT FALSE,
  has_lauzon BOOLEAN DEFAULT FALSE,

  -- Manufacturer codes (R, L, both)
  manufacturer_code VARCHAR(20),     -- 'R', 'L', 'both'

  -- Organization
  category VARCHAR(100),
  tags TEXT[] DEFAULT '{}',

  -- Flexible metadata for additional fields
  metadata JSONB DEFAULT '{}',

  -- Embedding for semantic search
  embedding vector(768),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

-- Import history: tracks each CSV upload
CREATE TABLE IF NOT EXISTS dealer_imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Import metadata
  filename VARCHAR(255),
  source VARCHAR(100) DEFAULT 'csv',

  -- Statistics
  total_rows INTEGER NOT NULL DEFAULT 0,
  dealers_created INTEGER NOT NULL DEFAULT 0,
  dealers_updated INTEGER NOT NULL DEFAULT 0,
  work_items_created INTEGER NOT NULL DEFAULT 0,
  work_items_updated INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  error_details TEXT[],

  -- Import state
  status VARCHAR(30) DEFAULT 'completed',  -- 'pending', 'processing', 'completed', 'failed'

  -- Timestamps
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Dealer display work items: individual display obligations per manufacturer
CREATE TABLE IF NOT EXISTS dealer_display_work (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Relationships
  dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  import_id UUID REFERENCES dealer_imports(id) ON DELETE SET NULL,

  -- Manufacturer
  manufacturer VARCHAR(50) NOT NULL,  -- 'responsive', 'lauzon'

  -- Display type and quantity (normalized from CSV columns)
  display_type VARCHAR(100) NOT NULL,  -- e.g., 'Showcase', 'Triple Tower', 'Pure Series'
  quantity INTEGER NOT NULL DEFAULT 0,

  -- Sales figures (from CSV, e.g., "Resp Sales 2025")
  sales_amount DECIMAL(12, 2),
  sales_period VARCHAR(50),            -- e.g., '2025'

  -- Work status
  status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'in_progress', 'completed', 'cancelled'
  notes TEXT,

  -- Flexible metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

-- Indexes for dealers
CREATE INDEX IF NOT EXISTS idx_dealers_account ON dealers (account_number);
CREATE INDEX IF NOT EXISTS idx_dealers_name ON dealers (name);
CREATE INDEX IF NOT EXISTS idx_dealers_rep ON dealers (rep_name);
CREATE INDEX IF NOT EXISTS idx_dealers_responsive ON dealers (has_responsive) WHERE has_responsive = TRUE;
CREATE INDEX IF NOT EXISTS idx_dealers_lauzon ON dealers (has_lauzon) WHERE has_lauzon = TRUE;
CREATE INDEX IF NOT EXISTS idx_dealers_city_state ON dealers (city, state);
CREATE INDEX IF NOT EXISTS idx_dealers_archived ON dealers (archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dealers_tags ON dealers USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_dealers_metadata ON dealers USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_dealers_embedding ON dealers
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Indexes for dealer_imports
CREATE INDEX IF NOT EXISTS idx_dealer_imports_date ON dealer_imports (imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_imports_status ON dealer_imports (status);

-- Indexes for dealer_display_work
CREATE INDEX IF NOT EXISTS idx_ddw_dealer ON dealer_display_work (dealer_id);
CREATE INDEX IF NOT EXISTS idx_ddw_import ON dealer_display_work (import_id);
CREATE INDEX IF NOT EXISTS idx_ddw_manufacturer ON dealer_display_work (manufacturer);
CREATE INDEX IF NOT EXISTS idx_ddw_display_type ON dealer_display_work (display_type);
CREATE INDEX IF NOT EXISTS idx_ddw_status ON dealer_display_work (status);
CREATE INDEX IF NOT EXISTS idx_ddw_archived ON dealer_display_work (archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ddw_metadata ON dealer_display_work USING GIN (metadata);

-- Composite index for common query: active work items by manufacturer
CREATE INDEX IF NOT EXISTS idx_ddw_mfr_status ON dealer_display_work (manufacturer, status)
  WHERE archived_at IS NULL;

-- Composite index for dealer+manufacturer lookups
CREATE INDEX IF NOT EXISTS idx_ddw_dealer_mfr ON dealer_display_work (dealer_id, manufacturer)
  WHERE archived_at IS NULL;

COMMENT ON TABLE dealers IS 'Dealer profiles - account_number is the durable identity backbone';
COMMENT ON TABLE dealer_imports IS 'History of CSV imports for audit trail';
COMMENT ON TABLE dealer_display_work IS 'Individual display obligations per dealer per manufacturer';
COMMENT ON COLUMN dealers.account_number IS 'Primary durable identifier from source systems (e.g., WOOD111GAL)';
COMMENT ON COLUMN dealers.manufacturer_code IS 'R=Responsive only, L=Lauzon only, both=participates in both programs';
COMMENT ON COLUMN dealer_display_work.display_type IS 'Type of display: Showcase, Triple Tower, Two Tower, Elite Conv, Pure Series, Mini Rev, etc.';
