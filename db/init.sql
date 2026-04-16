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
