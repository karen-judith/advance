CREATE TABLE IF NOT EXISTS monedas (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(50) NOT NULL,
  simbolo VARCHAR(10) NOT NULL,
  precio_usd DECIMAL(18, 8) NOT NULL
);

INSERT INTO monedas (nombre, simbolo, precio_usd) VALUES
  ('Bitcoin', 'BTC', 63284.50),
  ('Ethereum', 'ETH', 3450.20),
  ('Binance Coin', 'BNB', 590.30),
  ('Solana', 'SOL', 145.80);

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  saldo_usd DECIMAL(18, 8) DEFAULT 10000.00,
  security_pin VARCHAR(6),
  reset_code VARCHAR(6),
  reset_code_expiry TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS withdrawal_log (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  amount DECIMAL(18, 8) NOT NULL,
  amount_encrypted TEXT NOT NULL,
  method VARCHAR(50) NOT NULL,
  bank_name VARCHAR(100),
  account_number VARCHAR(50),
  account_type VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reference TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS access_log (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL CHECK (action IN ('login', 'logout', 'register')),
  ip_address VARCHAR(45),
  user_agent TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'success',
  detail TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deposit_log (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  amount DECIMAL(18, 8) NOT NULL,
  amount_encrypted TEXT NOT NULL,
  method VARCHAR(50) DEFAULT 'manual',
  reference TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trade_audit (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  moneda_id INTEGER REFERENCES monedas(id) ON DELETE RESTRICT,
  tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('compra', 'venta')),
  cantidad DECIMAL(18, 8) NOT NULL,
  cantidad_encrypted TEXT NOT NULL,
  precio_usd DECIMAL(18, 8) NOT NULL,
  precio_encrypted TEXT NOT NULL,
  total_usd DECIMAL(18, 8) NOT NULL,
  total_encrypted TEXT NOT NULL,
  saldo_before DECIMAL(18, 8) NOT NULL,
  saldo_after DECIMAL(18, 8) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  saldo_usd DECIMAL(18, 8) NOT NULL,
  saldo_encrypted TEXT NOT NULL,
  snapshot_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transacciones (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  moneda_id INTEGER REFERENCES monedas(id) ON DELETE RESTRICT,
  tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('compra', 'venta')),
  cantidad DECIMAL(18, 8) NOT NULL,
  precio_usd DECIMAL(18, 8) NOT NULL,
  total_usd DECIMAL(18, 8) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portafolios (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  moneda_id INTEGER REFERENCES monedas(id) ON DELETE CASCADE,
  cantidad DECIMAL(18, 8) DEFAULT 0,
  UNIQUE(usuario_id, moneda_id)
);

-- Usuario demo (clave: 123456)
INSERT INTO usuarios (nombre, email, password_hash) VALUES
  ('Usuario Demo', 'demo@advance.com', '$2b$10$w.cfV6pJbYx.OWUia6jmXeOP4tf1tmaURLOCjcJWlYtr.cwhQqFBC')
ON CONFLICT (email) DO NOTHING;
