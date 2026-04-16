const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

app.get('/api/precios', async (req, res) => {
  const result = await pool.query('SELECT * FROM monedas');
  res.json(result.rows);
});

app.listen(5000, () => {
  console.log('Backend corriendo en puerto 5000');
});
