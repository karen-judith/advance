const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
require('dotenv').config();

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


const app = express();
app.use(cors());
app.use(express.json());

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
app.post('/api/send-code', async (req, res) => {
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
app.post('/api/register', async (req, res) => {
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
      [userId, 10000.00, encryptValue(10000.00)]
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
app.post('/api/login', async (req, res) => {
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
app.post('/api/forgot-password', async (req, res) => {
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
app.post('/api/reset-password', async (req, res) => {
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
app.post('/api/trade', async (req, res) => {
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
app.post('/api/deposit', async (req, res) => {
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
app.post('/api/user/:id/set-pin', async (req, res) => {
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
app.post('/api/payment/confirm', async (req, res) => {
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

// Webhook de MercadoPago
app.post('/api/payment/webhook', async (req, res) => {
  const { type, data } = req.body;
  
  if (type === 'payment') {
    const paymentId = data.id;
    try {
      const payment = await mpPayment.get({ id: paymentId });
      
      if (payment.status === 'approved') {
        const amount = payment.transaction_amount;
        const externalRef = payment.id;
        const payerEmail = payment.payer?.email;
        
        // Buscar usuario por email
        const userResult = await pool.query('SELECT id FROM usuarios WHERE email = $1', [payerEmail]);
        if (userResult.rows.length > 0) {
          const userId = userResult.rows[0].id;
          const amountUsd = amount / 4000; // Conversión aproximada COP a USD
          
          await pool.query('BEGIN');
          await pool.query('UPDATE usuarios SET saldo_usd = saldo_usd + $1 WHERE id = $2', [amountUsd, userId]);
          await pool.query(
            `INSERT INTO deposit_log (usuario_id, amount, amount_encrypted, method, reference, status)
             VALUES ($1, $2, $3, 'mercadopago', $4, 'completed')`,
            [userId, amountUsd, encryptValue(amountUsd), `MP-${externalRef}`]
          );
          await pool.query(
            `INSERT INTO balance_snapshots (usuario_id, saldo_usd, saldo_encrypted)
             SELECT $1, saldo_usd, encryptValue(saldo_usd) FROM usuarios WHERE id = $1`,
            [userId]
          );
          await pool.query('COMMIT');
          console.log('DEPOSITO APROBADO - Usuario:', userId, 'Monto COP:', amount, 'USD:', amountUsd);
        }
      }
    } catch (err) {
      console.error('Webhook error:', err);
    }
  }
  
  res.sendStatus(200);
});

// Solicitar retiro
app.post('/api/withdraw', async (req, res) => {
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
      html: `<b>Código de retiro:</b> <span style="font-size:24px;color:#ef4444;font-weight:bold">${verifyCode}</span><br><br>Monto: <b>$${amount} USD</b><br>Ingresa este código para confirmar el retiro.`
    });

    res.json({ success: true, message: 'Código de verificación enviado a tu email' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Confirmar retiro con código
app.post('/api/withdraw/confirm', async (req, res) => {
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
    const [deposits, withdrawals, trades] = await Promise.all([
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
      )
    ]);
    
    res.json({
      deposits: deposits.rows,
      withdrawals: withdrawals.rows,
      trades: trades.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(5000, () => {
  console.log('Backend corriendo en puerto 5000');
});
