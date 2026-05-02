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
