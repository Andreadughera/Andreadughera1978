CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signals (
  id serial PRIMARY KEY,
  symbol text NOT NULL,
  type text NOT NULL,
  price real NOT NULL,
  rsi real NOT NULL,
  ma_short real NOT NULL,
  ma_long real NOT NULL,
  confidence real NOT NULL,
  reason text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signals_symbol_created_at_idx ON signals (symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS signals_created_at_idx ON signals (created_at DESC);

CREATE TABLE IF NOT EXISTS trades (
  id serial PRIMARY KEY,
  symbol text NOT NULL,
  signal_id integer,
  side text NOT NULL,
  quantity real NOT NULL,
  entry_price real NOT NULL,
  tp_price real NOT NULL,
  sl_price real NOT NULL,
  exit_price real,
  pnl_usd real,
  closed_at timestamp,
  is_listing boolean DEFAULT false,
  status text NOT NULL DEFAULT 'PENDING',
  binance_order_id text,
  confidence real NOT NULL,
  error_message text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trades_symbol_status_idx ON trades (symbol, status);
CREATE INDEX IF NOT EXISTS trades_status_side_idx ON trades (status, side);
CREATE INDEX IF NOT EXISTS trades_created_at_idx ON trades (created_at DESC);

CREATE TABLE IF NOT EXISTS new_listings (
  id serial PRIMARY KEY,
  symbol text NOT NULL UNIQUE,
  instrument text NOT NULL,
  volume_24h real,
  trade_executed boolean DEFAULT false,
  order_id text,
  entry_price real,
  tp_price real,
  sl_price real,
  status text NOT NULL DEFAULT 'DETECTED',
  first_seen_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id serial PRIMARY KEY,
  date text NOT NULL UNIQUE,
  capital_start real,
  capital_end real,
  trades_count integer NOT NULL DEFAULT 0,
  win_count integer NOT NULL DEFAULT 0,
  loss_count integer NOT NULL DEFAULT 0,
  pnl_usd real NOT NULL DEFAULT 0,
  best_symbol text,
  best_pnl real,
  worst_symbol text,
  worst_pnl real,
  open_positions_count integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id serial PRIMARY KEY,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
