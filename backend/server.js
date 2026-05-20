const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const helmet = require('helmet');
require('dotenv').config();

// Helmet - Security headers (CSP, X-Frame-Options, etc.)
const app = express();
app.use(helmet());

// CORS restringido (solo orígenes permitidos)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Origen no permitido por CORS'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

// Rate Limiting global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Demasiadas peticiones. Intenta nuevamente en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use(globalLimiter);

// Rate Limiting para auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos. Espera 15 minutos.' },
  skipSuccessfulRequests: true
});

// Rate Limiting para pagos
const paymentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  message: { error: 'Demasiados intentos de pago. Espera 5 minutos.' }
});

// Helper: validar resultados de express-validator
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

// Helper: sanitizar strings para HTML (previene XSS)
function sanitizeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Helper: validar URL
function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Helper: obtener tasa de cambio COP→USD (API dinámica)
let cachedRate = 4000;
let lastRateUpdate = 0;
async function getExchangeRate() {
  const now = Date.now();
  if (now - lastRateUpdate < 3600000) return cachedRate; // Cache 1 hora
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await res.json();
    cachedRate = data.rates?.COP || 4000;
    lastRateUpdate = now;
    console.log('Tasa de cambio actualizada: 1 USD =', cachedRate, 'COP');
  } catch (err) {
    console.error('Error obteniendo tasa de cambio, usando cache:', cachedRate);
  }
  return cachedRate;
}

// MercadoPago Client
const mpClient = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '' });
const mpPreference = new Preference(mpClient);
const mpPayment = new Payment(mpClient);

// Módulo de encriptación AES-256 (código secreto)
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY || 'A458C92E71B6D4F8E3A097C5D2B86F1A3C7E5D9B0F2A8C4E6B1D3F7A5C9E0D2B', 'hex');

function encryptValue(value) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(String(value), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

function decryptValue(encryptedStr) {
  try {
    const [ivHex, encryptedHex] = encryptedStr.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('DECRYPT ERROR:', err);
    return null;
  }
}

// Función para loguear accesos
async function logAccess(usuario_id, action, req, status = 'success', detail = '') {
  try {
    await pool.query(
      `INSERT INTO access_log (usuario_id, action, ip_address, user_agent, status, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [usuario_id, action, req.ip, req.headers['user-agent'] || '', status, detail]
    );
  } catch (err) {
    console.error('Error logging access:', err);
  }
}

// Configuración de nodemailer con SMTP real
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 465,
  secure: process.env.SMTP_SECURE === 'true' || true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const verificationCodes = new Map(); // email -> { code, expiresAt }

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

app.get('/api/precios', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM monedas');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para generar y enviar código de verificación
// Enviar código con rate limiting y validación
app.post('/api/send-code', authLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido')
], async (req, res) => {
  if (!validate(req, res)) return;
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  try {
    // Generar código de 6 dígitos
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutos
    
    verificationCodes.set(email, { code, expiresAt });
    console.log("CODIGO DE VERIFICACION para", email, ":", code);

    const info = await transporter.sendMail({
      from: '"Advance Trading" <no-reply@advance.com>',
      to: email,
      subject: 'Tu código de verificación - Advance',
      text: `Tu código de verificación es: ${code}. Expirará en 10 minutos.`,
      html: `<b>Tu código de verificación es: <span style="font-size:20px; color:#a855f7">${code}</span></b><br>Expirará en 10 minutos.`
    });

    console.log("Mensaje enviado: %s", info.messageId);
    console.log("URL de vista previa (solo pruebas): %s", nodemailer.getTestMessageUrl(info));

    res.json({ success: true, message: 'Código enviado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar el correo' });
  }
});

// Endpoint de registro
// Registro con rate limiting y validación
app.post('/api/register', authLimiter, [
  body('nombre').trim().isLength({ min: 2, max: 100 }).withMessage('Nombre inválido'),
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('password').isLength({ min: 6, max: 100 }).withMessage('Contraseña debe tener al menos 6 caracteres'),
  body('code').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Código inválido')
], async (req, res) => {
  if (!validate(req, res)) return;

  const { nombre, email, password, code } = req.body;
  
  console.log('REGISTER - email:', email, '| nombre:', nombre, '| password length:', password ? password.length : 'N/A', '| code:', code);
  
  if (!code) return res.status(400).json({ error: 'Código de verificación requerido' });
  
  const savedCodeData = verificationCodes.get(email);
  if (!savedCodeData) return res.status(400).json({ error: 'No se ha solicitado un código para este email' });
  if (savedCodeData.expiresAt < Date.now()) return res.status(400).json({ error: 'El código ha expirado' });
  if (savedCodeData.code !== code) return res.status(400).json({ error: 'Código inválido' });

  try {
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    console.log('REGISTER - password_hash generado:', passwordHash);
    
    const result = await pool.query(
      'INSERT INTO usuarios (nombre, email, password_hash) VALUES ($1, $2, $3) RETURNING id, nombre, email, saldo_usd',
      [nombre, email, passwordHash]
    );
    
    console.log('REGISTER - usuario creado:', result.rows[0]);
    
    // Loguear registro
    const userId = result.rows[0].id;
    await logAccess(userId, 'register', req, 'success', 'Nuevo usuario registrado');
    
    // Crear snapshot inicial de saldo
    await pool.query(
      `INSERT INTO balance_snapshots (usuario_id, saldo_usd, saldo_encrypted)
       VALUES ($1, $2, $3)`,
      [userId, 0.00, encryptValue(0.00)]
    );
    
    // Eliminar código usado
    verificationCodes.delete(email);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') { // Unique violation para el email
      return res.status(400).json({ error: 'El email ya está registrado' });
    }
    console.error('REGISTER - error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint de login
// Login con rate limiting y validación
app.post('/api/login', authLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('password').notEmpty().withMessage('Contraseña requerida')
], async (req, res) => {
  if (!validate(req, res)) return;
  const { email, password } = req.body;
  
  console.log('LOGIN - email:', email, '| password:', password);
  
  try {
    const result = await pool.query('SELECT id, nombre, email, password_hash, saldo_usd FROM usuarios WHERE email = $1', [email]);
    
    console.log('LOGIN - rows found:', result.rows.length);
    
    if (result.rows.length === 0) {
      await logAccess(null, 'login', req, 'failed', 'Usuario no encontrado: ' + email);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    
    console.log('LOGIN - password match:', match);
    
    if (!match) {
      await logAccess(user.id, 'login', req, 'failed', 'Contraseña incorrecta');
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    // Loguear acceso exitoso
    await logAccess(user.id, 'login', req, 'success');
    
    // Crear snapshot de saldo
    await pool.query(
      `INSERT INTO balance_snapshots (usuario_id, saldo_usd, saldo_encrypted)
       VALUES ($1, $2, $3)`,
      [user.id, user.saldo_usd, encryptValue(user.saldo_usd)]
    );
    
    // Eliminar password_hash del objeto de respuesta por seguridad
    delete user.password_hash;
    
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para solicitar código de recuperación de contraseña
// Forgot password con rate limiting y validación
app.post('/api/forgot-password', authLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido')
], async (req, res) => {
  if (!validate(req, res)) return;
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  try {
    // Verificar si el usuario existe
    const userResult = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'No existe una cuenta con este email' });
    }

    // Generar código de 6 dígitos
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

    // Guardar código en la base de datos
    await pool.query(
      'UPDATE usuarios SET reset_code = $1, reset_code_expiry = $2 WHERE email = $3',
      [code, expiresAt, email]
    );

    console.log("CODIGO DE RECUPERACION para", email, ":", code);

    const info = await transporter.sendMail({
      from: '"Advance Trading" <no-reply@advance.com>',
      to: email,
      subject: 'Recuperación de contraseña - Advance',
      text: `Tu código de recuperación es: ${code}. Expirará en 10 minutos.`,
      html: `<b>Tu código de recuperación es: <span style="font-size:20px; color:#a855f7">${code}</span></b><br>Expirará en 10 minutos.`
    });

    console.log("Mensaje enviado: %s", info.messageId);
    res.json({ success: true, message: 'Código de recuperación enviado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar el correo' });
  }
});

// Endpoint para verificar código de recuperación
app.post('/api/verify-reset-code', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email y código requeridos' });

  try {
    const result = await pool.query(
      'SELECT reset_code, reset_code_expiry FROM usuarios WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Email no encontrado' });
    }

    const user = result.rows[0];

    if (!user.reset_code || user.reset_code !== code) {
      return res.status(400).json({ error: 'Código inválido' });
    }

    if (new Date(user.reset_code_expiry) < new Date()) {
      return res.status(400).json({ error: 'El código ha expirado' });
    }

    res.json({ success: true, message: 'Código válido' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para cambiar contraseña
// Reset password con validación
app.post('/api/reset-password', authLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('code').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Código inválido'),
  body('newPassword').isLength({ min: 6, max: 100 }).withMessage('Contraseña debe tener al menos 6 caracteres')
], async (req, res) => {
  if (!validate(req, res)) return;
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, código y nueva contraseña requeridos' });
  }

  try {
    const result = await pool.query(
      'SELECT reset_code, reset_code_expiry FROM usuarios WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Email no encontrado' });
    }

    const user = result.rows[0];

    if (!user.reset_code || user.reset_code !== code) {
      return res.status(400).json({ error: 'Código inválido' });
    }

    if (new Date(user.reset_code_expiry) < new Date()) {
      return res.status(400).json({ error: 'El código ha expirado' });
    }

    // Hash de la nueva contraseña
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Actualizar contraseña y limpiar código
    await pool.query(
      'UPDATE usuarios SET password_hash = $1, reset_code = NULL, reset_code_expiry = NULL WHERE email = $2',
      [passwordHash, email]
    );

    console.log('PASSWORD RESET - Contraseña actualizada para:', email);
    res.json({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint de transacciones (compra/venta)
// Trade con validación de entrada
app.post('/api/trade', [
  body('usuario_id').isInt({ min: 1 }).withMessage('Usuario inválido'),
  body('moneda_id').isInt({ min: 1 }).withMessage('Moneda inválida'),
  body('tipo').isIn(['compra', 'venta']).withMessage('Tipo debe ser compra o venta'),
  body('cantidad').isFloat({ min: 0.00000001 }).withMessage('Cantidad debe ser mayor a 0'),
  body('precio_usd').isFloat({ min: 0.01 }).withMessage('Precio inválido')
], async (req, res) => {
  if (!validate(req, res)) return;
  const { usuario_id, moneda_id, tipo, cantidad, precio_usd } = req.body;
  
  try {
    await pool.query('BEGIN'); // Iniciar transacción SQL
    
    const total_usd = cantidad * precio_usd;
    
    // 1. Obtener saldo del usuario
    const userResult = await pool.query('SELECT saldo_usd FROM usuarios WHERE id = $1', [usuario_id]);
    if (userResult.rows.length === 0) throw new Error('Usuario no encontrado');
    let saldo_usd = parseFloat(userResult.rows[0].saldo_usd);
    const saldo_before = saldo_usd;

    // 2. Obtener portafolio actual de la moneda
    const portfolioResult = await pool.query('SELECT cantidad FROM portafolios WHERE usuario_id = $1 AND moneda_id = $2', [usuario_id, moneda_id]);
    let cantidadMoneda = portfolioResult.rows.length > 0 ? parseFloat(portfolioResult.rows[0].cantidad) : 0;

    // 3. Validar y calcular nuevos saldos
    if (tipo === 'compra') {
      if (saldo_usd < total_usd) throw new Error('Saldo USD insuficiente');
      saldo_usd -= total_usd;
      cantidadMoneda += cantidad;
    } else if (tipo === 'venta') {
      if (cantidadMoneda < cantidad) throw new Error('Saldo de moneda insuficiente');
      saldo_usd += total_usd;
      cantidadMoneda -= cantidad;
    } else {
      throw new Error('Tipo de transacción inválido');
    }
    
    const saldo_after = saldo_usd;

    // 4. Actualizar usuario
    await pool.query('UPDATE usuarios SET saldo_usd = $1 WHERE id = $2', [saldo_usd, usuario_id]);

    // 5. Actualizar portafolio
    if (portfolioResult.rows.length > 0) {
      await pool.query('UPDATE portafolios SET cantidad = $1 WHERE usuario_id = $2 AND moneda_id = $3', [cantidadMoneda, usuario_id, moneda_id]);
    } else {
      await pool.query('INSERT INTO portafolios (usuario_id, moneda_id, cantidad) VALUES ($1, $2, $3)', [usuario_id, moneda_id, cantidadMoneda]);
    }

    // 6. Registrar transacción
    const transaccion = await pool.query(
      'INSERT INTO transacciones (usuario_id, moneda_id, tipo, cantidad, precio_usd, total_usd) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [usuario_id, moneda_id, tipo, cantidad, precio_usd, total_usd]
    );

    // 7. Registrar auditoría encriptada (código secreto)
    await pool.query(
      `INSERT INTO trade_audit (usuario_id, moneda_id, tipo, cantidad, cantidad_encrypted, precio_usd, precio_encrypted, total_usd, total_encrypted, saldo_before, saldo_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [usuario_id, moneda_id, tipo, cantidad, encryptValue(cantidad), precio_usd, encryptValue(precio_usd), total_usd, encryptValue(total_usd), saldo_before, saldo_after]
    );

    // 8. Crear snapshot de saldo actualizado
    await pool.query(
      `INSERT INTO balance_snapshots (usuario_id, saldo_usd, saldo_encrypted)
       VALUES ($1, $2, $3)`,
      [usuario_id, saldo_usd, encryptValue(saldo_usd)]
    );

    await pool.query('COMMIT'); // Confirmar transacción SQL
    
    res.json({ success: true, transaccion: transaccion.rows[0], nuevo_saldo_usd: saldo_usd });
  } catch (err) {
    await pool.query('ROLLBACK'); // Revertir en caso de error
    res.status(400).json({ error: err.message });
  }
});

// Endpoint para obtener el portafolio y saldo de un usuario
app.get('/api/usuario/:id/portafolio', async (req, res) => {
  const { id } = req.params;
  try {
    const userResult = await pool.query('SELECT id, nombre, email, saldo_usd FROM usuarios WHERE id = $1', [id]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    const portfolioResult = await pool.query(`
      SELECT p.cantidad, m.nombre, m.simbolo, m.precio_usd 
      FROM portafolios p
      JOIN monedas m ON p.moneda_id = m.id
      WHERE p.usuario_id = $1 AND p.cantidad > 0
    `, [id]);
    
    const transactionsResult = await pool.query(`
      SELECT t.*, m.nombre as moneda_nombre, m.simbolo 
      FROM transacciones t
      JOIN monedas m ON t.moneda_id = m.id
      WHERE t.usuario_id = $1
      ORDER BY t.created_at DESC
    `, [id]);

    res.json({
      usuario: userResult.rows[0],
      portafolio: portfolioResult.rows,
      transacciones: transactionsResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para obtener historial de accesos
app.get('/api/usuario/:id/access-log', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT a.id, a.action, a.ip_address, a.user_agent, a.status, a.detail, a.created_at,
              u.nombre as usuario_nombre
       FROM access_log a
       LEFT JOIN usuarios u ON a.usuario_id = u.id
       WHERE a.usuario_id = $1
       ORDER BY a.created_at DESC
       LIMIT 50`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para obtener auditoría de trades encriptada
app.get('/api/usuario/:id/trade-audit', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT t.id, t.tipo, t.cantidad, t.precio_usd, t.total_usd, t.saldo_before, t.saldo_after,
              t.created_at, m.simbolo, m.nombre as moneda_nombre
       FROM trade_audit t
       LEFT JOIN monedas m ON t.moneda_id = m.id
       WHERE t.usuario_id = $1
       ORDER BY t.created_at DESC
       LIMIT 100`,
      [id]
    );
    
    // Desencriptar valores para el usuario autenticado
    const decrypted = result.rows.map(row => ({
      ...row,
      cantidad_encrypted: row.cantidad,
      precio_encrypted: row.precio_usd,
      total_encrypted: row.total_usd,
      is_encrypted: true
    }));
    
    res.json(decrypted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para obtener snapshots de saldo
app.get('/api/usuario/:id/balance-history', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, saldo_usd, snapshot_date, created_at
       FROM balance_snapshots
       WHERE usuario_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para depositar saldo (registro con encriptación)
// Deposit con validación
app.post('/api/deposit', [
  body('usuario_id').isInt({ min: 1 }).withMessage('Usuario inválido'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Monto inválido')
], async (req, res) => {
  if (!validate(req, res)) return;
  const { usuario_id, amount, method, reference } = req.body;
  
  if (!usuario_id || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Usuario y monto requeridos' });
  }

  try {
    await pool.query('BEGIN');
    
    // Actualizar saldo
    const userResult = await pool.query('SELECT saldo_usd FROM usuarios WHERE id = $1', [usuario_id]);
    if (userResult.rows.length === 0) throw new Error('Usuario no encontrado');
    
    const newSaldo = parseFloat(userResult.rows[0].saldo_usd) + parseFloat(amount);
    await pool.query('UPDATE usuarios SET saldo_usd = $1 WHERE id = $2', [newSaldo, usuario_id]);
    
    // Registrar depósito encriptado
    await pool.query(
      `INSERT INTO deposit_log (usuario_id, amount, amount_encrypted, method, reference)
       VALUES ($1, $2, $3, $4, $5)`,
      [usuario_id, amount, encryptValue(amount), method || 'manual', reference || '']
    );
    
    // Crear snapshot de saldo
    await pool.query(
      `INSERT INTO balance_snapshots (usuario_id, saldo_usd, saldo_encrypted)
       VALUES ($1, $2, $3)`,
      [usuario_id, newSaldo, encryptValue(newSaldo)]
    );
    
    await pool.query('COMMIT');
    
    res.json({ success: true, nuevo_saldo_usd: newSaldo });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  }
});

// Endpoint para obtener historial de depósitos
app.get('/api/usuario/:id/deposits', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT d.id, d.amount, d.method, d.reference, d.status, d.created_at
       FROM deposit_log d
       WHERE d.usuario_id = $1
       ORDER BY d.created_at DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// PAGOS REALES CON MERCADOPAGO (Colombia/Latam)
// ==========================================

// Configurar PIN de seguridad (2FA para depósitos)
// Set PIN con validación
app.post('/api/user/:id/set-pin', [
  param('id').isInt({ min: 1 }).withMessage('ID inválido'),
  body('pin').isLength({ min: 6, max: 6 }).isNumeric().withMessage('El PIN debe ser de 6 dígitos numéricos')
], async (req, res) => {
  if (!validate(req, res)) return;
  const { pin } = req.body;
  const { id } = req.params;
  if (!pin || pin.length !== 6 || !/^\d+$/.test(pin)) {
    return res.status(400).json({ error: 'El PIN debe ser de 6 dígitos numéricos' });
  }
  try {
    const pinHash = await bcrypt.hash(pin, 10);
    await pool.query('UPDATE usuarios SET security_pin = $1 WHERE id = $2', [pinHash, id]);
    res.json({ success: true, message: 'PIN configurado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verificar PIN de seguridad
app.post('/api/user/:id/verify-pin', async (req, res) => {
  const { pin } = req.body;
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT security_pin FROM usuarios WHERE id = $1', [id]);
    if (result.rows.length === 0 || !result.rows[0].security_pin) {
      return res.status(400).json({ error: 'No tienes un PIN configurado' });
    }
    const match = await bcrypt.compare(pin, result.rows[0].security_pin);
    if (!match) return res.status(401).json({ error: 'PIN incorrecto' });
    res.json({ success: true, message: 'PIN verificado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear preferencia de pago en MercadoPago (para depósito)
app.post('/api/payment/create', async (req, res) => {
  const { usuario_id, amount, email, nombre } = req.body;
  
  if (!usuario_id || !amount || amount < 10000) {
    return res.status(400).json({ error: 'Monto mínimo $10,000 COP' });
  }

  try {
    // Generar código de verificación de 6 dígitos
    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Guardar código en session temporal (email)
    verificationCodes.set(`deposit_${usuario_id}`, { code: verifyCode, expiresAt: Date.now() + 10 * 60 * 1000 });
    
    // Enviar código por email
    await transporter.sendMail({
      from: '"Advance Trading" <no-reply@advance.com>',
      to: email,
      subject: 'Verificación de depósito - Advance',
      text: `Tu código de verificación para depósito es: ${verifyCode}`,
      html: `<b>Código de verificación:</b> <span style="font-size:24px;color:#a855f7;font-weight:bold">${verifyCode}</span><br><br>Ingresa este código para confirmar tu depósito.`
    });

    res.json({ success: true, message: 'Código de verificación enviado a tu email' });
  } catch (err) {
    console.error('Error creating payment:', err);
    res.status(500).json({ error: 'Error al crear preferencia de pago' });
  }
});

// Verificar código de depósito y crear pago en MercadoPago
// Confirmar pago con rate limiting y validación
app.post('/api/payment/confirm', paymentLimiter, [
  body('usuario_id').isInt({ min: 1 }).withMessage('Usuario inválido'),
  body('amount').isFloat({ min: 10000 }).withMessage('Monto mínimo 10,000 COP'),
  body('code').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Código inválido'),
  body('pin').isLength({ min: 6, max: 6 }).isNumeric().withMessage('PIN inválido'),
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('nombre').trim().isLength({ min: 2, max: 100 }).withMessage('Nombre inválido')
], async (req, res) => {
  if (!validate(req, res)) return;
  const { usuario_id, amount, code, pin, email, nombre } = req.body;
  
  if (!usuario_id || !amount || !code || !pin) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }

  try {
    // 1. Verificar código de email
    const savedCode = verificationCodes.get(`deposit_${usuario_id}`);
    if (!savedCode) return res.status(400).json({ error: 'No se ha solicitado un código' });
    if (savedCode.expiresAt < Date.now()) return res.status(400).json({ error: 'Código expirado' });
    if (savedCode.code !== code) return res.status(400).json({ error: 'Código incorrecto' });

    // 2. Verificar PIN de seguridad
    const pinResult = await pool.query('SELECT security_pin FROM usuarios WHERE id = $1', [usuario_id]);
    if (!pinResult.rows[0].security_pin) return res.status(400).json({ error: 'No tienes PIN configurado' });
    const pinMatch = await bcrypt.compare(pin, pinResult.rows[0].security_pin);
    if (!pinMatch) return res.status(401).json({ error: 'PIN de seguridad incorrecto' });

    // 3. Crear preferencia de pago en MercadoPago
    const preference = await mpPreference.create({
      body: {
        items: [{
          title: 'Depósito Advance Trading',
          unit_price: parseFloat(amount),
          quantity: 1,
          currency_id: 'COP'
        }],
        payer: { email, name: nombre },
        back_urls: {
          success: 'http://localhost:3000',
          failure: 'http://localhost:3000',
          pending: 'http://localhost:3000'
        },
        auto_return: 'approved',
        notification_url: 'https://your-domain.com/api/payment/webhook'
      }
    });

    // Limpiar código usado
    verificationCodes.delete(`deposit_${usuario_id}`);

    res.json({ success: true, init_point: preference.init_point, preference_id: preference.id });
  } catch (err) {
    console.error('Error confirming payment:', err);
    res.status(500).json({ error: 'Error al confirmar pago' });
  }
});

// Webhook de MercadoPago - Guarda TODO en la BD
app.post('/api/payment/webhook', async (req, res) => {
  const { type, data } = req.body;
  
  if (type === 'payment') {
    const paymentId = data.id;
    try {
      // Verificar si ya fue procesado
      const existing = await pool.query('SELECT id FROM mercadopago_payments WHERE mp_payment_id = $1', [paymentId]);
      if (existing.rows.length > 0) {
        console.log('PAGO YA PROCESADO - MP ID:', paymentId);
        return res.sendStatus(200);
      }
      
      const payment = await mpPayment.get({ id: paymentId });
      
      const amountCop = payment.transaction_amount;
      const mpStatus = payment.status;
      const mpStatusDetail = payment.status_detail;
      const mpMethod = payment.payment_method_id;
      const mpIssuer = payment.issuer_id;
      const mpInstallments = payment.installments;
      const mpFee = payment.transaction_details?.total_paid_amount - payment.transaction_details?.net_received_amount;
      const mpNetAmount = payment.transaction_details?.net_received_amount;
      const payerEmail = payment.payer?.email;
      const payerName = payment.payer?.name;
      const payerFirstName = payment.payer?.first_name;
      const payerLastName = payment.payer?.last_name;
      const cardHolder = payment.card?.cardholder?.name;
      const bankName = payment.bank_info?.collector?.name;
      const mpDateApproved = payment.date_approved;
      const mpDateCreated = payment.date_created;
      const mpCurrency = payment.currency_id;
      const preferenceId = payment.preference_id;
      
      // Buscar usuario por email del payer
      const userResult = await pool.query('SELECT id, nombre, email FROM usuarios WHERE email = $1', [payerEmail]);
      
      if (userResult.rows.length > 0) {
        const userId = userResult.rows[0].id;
        const exchangeRate = await getExchangeRate(); // Tasa dinámica
        const amountUsd = amountCop / exchangeRate;
        
        // Guardar en mercadopago_payments con TODOS los detalles
        await pool.query(
          `INSERT INTO mercadopago_payments (
            usuario_id, mp_payment_id, amount_cop, amount_cop_encrypted, amount_usd, amount_usd_encrypted,
            exchange_rate, payment_method, payer_email, payer_name, payer_first_name, payer_last_name,
            mp_status, mp_status_detail, mp_currency, mp_installments, mp_net_amount, mp_fee,
            mp_date_approved, mp_date_created, mp_external_reference, mp_card_holder, mp_bank_name,
            mp_issuer, mp_preference_id, mp_notification_url, flow_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
          [
            userId, paymentId, amountCop, encryptValue(amountCop), amountUsd, encryptValue(amountUsd),
            exchangeRate, mpMethod, payerEmail, payerName, payerFirstName, payerLastName,
            mpStatus, mpStatusDetail, mpCurrency, mpInstallments || 0, mpNetAmount, mpFee,
            mpDateApproved, mpDateCreated, paymentId, cardHolder, bankName,
            mpIssuer, preferenceId, isValidUrl(req.body?.notification_url) ? req.body.notification_url : null, 'deposit'
          ]
        );
        
        // Si el pago fue aprobado, actualizar saldo y deposit_log
        if (mpStatus === 'approved') {
          await pool.query('BEGIN');
          
          // Actualizar saldo del usuario
          await pool.query('UPDATE usuarios SET saldo_usd = saldo_usd + $1 WHERE id = $2', [amountUsd, userId]);
          
          // Registrar en deposit_log
          await pool.query(
            `INSERT INTO deposit_log (usuario_id, amount, amount_encrypted, method, reference, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, amountUsd, encryptValue(amountUsd), `mercadopago_${mpMethod}`, `MP-${paymentId}`, 'completed']
          );
          
          // Crear snapshot de saldo
          const newSaldoResult = await pool.query('SELECT saldo_usd FROM usuarios WHERE id = $1', [userId]);
          const newSaldo = parseFloat(newSaldoResult.rows[0].saldo_usd);
          await pool.query(
            `INSERT INTO balance_snapshots (usuario_id, saldo_usd, saldo_encrypted)
             VALUES ($1, $2, $3)`,
            [userId, newSaldo, encryptValue(newSaldo)]
          );
          
          await pool.query('COMMIT');
          console.log('DEPOSITO APROBADO - Usuario:', userId, 'COP:', amountCop, 'USD:', amountUsd, 'Método:', mpMethod);
        } else {
          console.log('PAGO PENDIENTE/FALLIDO - MP ID:', paymentId, 'Estado:', mpStatus, 'Detalle:', mpStatusDetail);
        }
      } else {
        // Pago sin usuario registrado - guardar de todos modos para auditoría
        console.log('PAGO SIN USUARIO - Email:', payerEmail, 'Monto:', amountCop);
        const exchangeRate = await getExchangeRate();
        await pool.query(
          `INSERT INTO mercadopago_payments (
            usuario_id, mp_payment_id, amount_cop, amount_cop_encrypted, amount_usd, amount_usd_encrypted,
            exchange_rate, payment_method, payer_email, payer_name, payer_first_name, payer_last_name,
            mp_status, mp_status_detail, mp_currency, mp_installments, mp_net_amount, mp_fee,
            mp_date_approved, mp_date_created, mp_external_reference, mp_card_holder, mp_bank_name,
            mp_issuer, mp_preference_id, mp_notification_url, flow_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
          [
            null, paymentId, amountCop, encryptValue(amountCop), amountCop / exchangeRate, encryptValue(amountCop / exchangeRate),
            exchangeRate, mpMethod, payerEmail, payerName, payerFirstName, payerLastName,
            mpStatus, mpStatusDetail, mpCurrency, mpInstallments || 0, mpNetAmount, mpFee,
            mpDateApproved, mpDateCreated, paymentId, cardHolder, bankName,
            mpIssuer, preferenceId, isValidUrl(req.body?.notification_url) ? req.body.notification_url : null, 'deposit'
          ]
        );
      }
    } catch (err) {
      console.error('Webhook error:', err);
    }
  }
  
  res.sendStatus(200);
});

// Solicitar retiro
// Solicitar retiro con rate limiting y validación
app.post('/api/withdraw', paymentLimiter, [
  body('usuario_id').isInt({ min: 1 }).withMessage('Usuario inválido'),
  body('amount').isFloat({ min: 1 }).withMessage('Monto inválido'),
  body('bank_name').trim().notEmpty().withMessage('Banco requerido'),
  body('account_number').trim().notEmpty().withMessage('Cuenta requerida'),
  body('account_type').isIn(['ahorros', 'corriente']).withMessage('Tipo de cuenta inválido'),
  body('pin').isLength({ min: 6, max: 6 }).isNumeric().withMessage('PIN inválido')
], async (req, res) => {
  if (!validate(req, res)) return;
  const { usuario_id, amount, method, bank_name, account_number, account_type, pin } = req.body;
  
  if (!usuario_id || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Monto inválido' });
  }
  
  try {
    // 1. Verificar PIN
    const pinResult = await pool.query('SELECT security_pin FROM usuarios WHERE id = $1', [usuario_id]);
    if (!pinResult.rows[0].security_pin) return res.status(400).json({ error: 'No tienes PIN configurado' });
    const pinMatch = await bcrypt.compare(pin, pinResult.rows[0].security_pin);
    if (!pinMatch) return res.status(401).json({ error: 'PIN incorrecto' });
    
    // 2. Verificar saldo suficiente
    const userResult = await pool.query('SELECT saldo_usd FROM usuarios WHERE id = $1', [usuario_id]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    const saldo = parseFloat(userResult.rows[0].saldo_usd);
    if (saldo < amount) return res.status(400).json({ error: 'Saldo insuficiente' });
    
    // 3. Enviar código de verificación por email
    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
    verificationCodes.set(`withdraw_${usuario_id}`, { code: verifyCode, amount, expiresAt: Date.now() + 10 * 60 * 1000 });
    
    // Obtener email del usuario
    const emailResult = await pool.query('SELECT email FROM usuarios WHERE id = $1', [usuario_id]);
    
    await transporter.sendMail({
      from: '"Advance Trading" <no-reply@advance.com>',
      to: emailResult.rows[0].email,
      subject: 'Verificación de retiro - Advance',
      text: `Tu código de verificación para retiro de $${amount} USD es: ${verifyCode}`,
      html: `<b>Código de retiro:</b> <span style="font-size:24px;color:#ef4444;font-weight:bold">${sanitizeHtml(verifyCode)}</span><br><br>Monto: <b>$${sanitizeHtml(amount)} USD</b><br>Ingresa este código para confirmar el retiro.`
    });

    res.json({ success: true, message: 'Código de verificación enviado a tu email' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Confirmar retiro con código
// Confirmar retiro con rate limiting y validación
app.post('/api/withdraw/confirm', paymentLimiter, [
  body('usuario_id').isInt({ min: 1 }).withMessage('Usuario inválido'),
  body('code').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Código inválido'),
  body('bank_name').trim().notEmpty().withMessage('Banco requerido'),
  body('account_number').trim().notEmpty().withMessage('Cuenta requerida')
], async (req, res) => {
  if (!validate(req, res)) return;
  const { usuario_id, code } = req.body;
  
  try {
    const savedCode = verificationCodes.get(`withdraw_${usuario_id}`);
    if (!savedCode) return res.status(400).json({ error: 'No hay retiro pendiente' });
    if (savedCode.expiresAt < Date.now()) return res.status(400).json({ error: 'Código expirado' });
    if (savedCode.code !== code) return res.status(400).json({ error: 'Código incorrecto' });
    
    const { amount } = savedCode;
    
    await pool.query('BEGIN');
    
    // Descontar saldo
    await pool.query('UPDATE usuarios SET saldo_usd = saldo_usd - $1 WHERE id = $2', [amount, usuario_id]);
    
    // Registrar retiro
    await pool.query(
      `INSERT INTO withdrawal_log (usuario_id, amount, amount_encrypted, method, bank_name, account_number, account_type, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing')`,
      [usuario_id, amount, encryptValue(amount), 'bank_transfer', req.body.bank_name, req.body.account_number, req.body.account_type]
    );
    
    // Snapshot
    await pool.query(
      `INSERT INTO balance_snapshots (usuario_id, saldo_usd, saldo_encrypted)
       VALUES ($1, saldo_usd, encryptValue(saldo_usd))`,
      [usuario_id]
    );
    
    await pool.query('COMMIT');
    verificationCodes.delete(`withdraw_${usuario_id}`);
    
    res.json({ success: true, message: 'Retiro procesado correctamente' });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// Historial completo de transacciones (depósitos + retiros + trades)
app.get('/api/user/:id/transaction-history', async (req, res) => {
  const { id } = req.params;
  
  try {
    const [deposits, withdrawals, trades, mpPayments] = await Promise.all([
      pool.query(
        `SELECT 'deposit' as type, id, amount as amount_usd, method, reference, status, created_at
         FROM deposit_log WHERE usuario_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
      pool.query(
        `SELECT 'withdrawal' as type, id, amount as amount_usd, method, bank_name, account_number, status, created_at
         FROM withdrawal_log WHERE usuario_id = $1 ORDER BY created_at DESC`,
        [id]
      ),
      pool.query(
        `SELECT 'trade' as type, t.id, t.total_usd as amount_usd, t.tipo, t.cantidad, t.precio_usd, m.simbolo, t.created_at
         FROM transacciones t
         LEFT JOIN monedas m ON t.moneda_id = m.id
         WHERE t.usuario_id = $1 ORDER BY t.created_at DESC`,
        [id]
      ),
      pool.query(
        `SELECT id, mp_payment_id, amount_cop, amount_usd, payment_method, mp_status, mp_status_detail,
                payer_email, payer_name, mp_fee, mp_net_amount, mp_date_approved, mp_date_created,
                mp_card_holder, mp_bank_name, mp_issuer, mp_installments, flow_type, created_at
         FROM mercadopago_payments
         WHERE usuario_id = $1
         ORDER BY created_at DESC`,
        [id]
      )
    ]);
    
    res.json({
      deposits: deposits.rows,
      withdrawals: withdrawals.rows,
      trades: trades.rows,
      mercadopago_payments: mpPayments.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint dedicado: historial completo de MercadoPago
app.get('/api/user/:id/mercadopago-history', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT mp.id, mp.mp_payment_id, mp.amount_cop, mp.amount_usd, mp.exchange_rate,
              mp.payment_method, mp.mp_status, mp.mp_status_detail, mp.mp_currency,
              mp.mp_fee, mp.mp_net_amount, mp.mp_installments, mp.mp_date_approved,
              mp.mp_date_created, mp.mp_card_holder, mp.mp_bank_name, mp.mp_issuer,
              mp.payer_email, mp.payer_name, mp.payer_first_name, mp.payer_last_name,
              mp.flow_type, mp.created_at
       FROM mercadopago_payments mp
       WHERE mp.usuario_id = $1
       ORDER BY mp.created_at DESC`,
      [id]
    );
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resumen financiero del usuario (todo el dinero que entró y salió)
app.get('/api/user/:id/financial-summary', async (req, res) => {
  const { id } = req.params;
  
  try {
    const [currentSaldo, totalDeposits, totalWithdrawals, totalTrades, mpSummary] = await Promise.all([
      pool.query('SELECT saldo_usd FROM usuarios WHERE id = $1', [id]),
      pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM deposit_log WHERE usuario_id = $1', [id]),
      pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM withdrawal_log WHERE usuario_id = $1 AND status IN (\'completed\', \'processing\')', [id]),
      pool.query(`SELECT 
        COALESCE(SUM(CASE WHEN tipo = 'compra' THEN total_usd ELSE 0 END), 0) as total_compras,
        COALESCE(SUM(CASE WHEN tipo = 'venta' THEN total_usd ELSE 0 END), 0) as total_ventas
        FROM transacciones WHERE usuario_id = $1`, [id]),
      pool.query(`SELECT 
        COUNT(*) as total_payments,
        COALESCE(SUM(amount_cop), 0) as total_cop,
        COALESCE(SUM(amount_usd), 0) as total_usd,
        COALESCE(SUM(mp_fee), 0) as total_fees,
        COALESCE(SUM(mp_net_amount), 0) as total_net
        FROM mercadopago_payments WHERE usuario_id = $1 AND mp_status = 'approved'`, [id])
    ]);
    
    res.json({
      current_balance: parseFloat(currentSaldo.rows[0]?.saldo_usd || 0),
      total_deposits: parseFloat(totalDeposits.rows[0].total),
      total_withdrawals: parseFloat(totalWithdrawals.rows[0].total),
      total_trades: {
        compras: parseFloat(totalTrades.rows[0].total_compras),
        ventas: parseFloat(totalTrades.rows[0].total_ventas)
      },
      mercadopago: {
        total_payments: parseInt(mpSummary.rows[0].total_payments),
        total_cop: parseFloat(mpSummary.rows[0].total_cop),
        total_usd: parseFloat(mpSummary.rows[0].total_usd),
        total_fees: parseFloat(mpSummary.rows[0].total_fees),
        total_net: parseFloat(mpSummary.rows[0].total_net)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(5000, () => {
  console.log('Backend corriendo en puerto 5000');
});
