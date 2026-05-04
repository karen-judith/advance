const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
require('dotenv').config();

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
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    
    console.log('LOGIN - password match:', match);
    
    if (!match) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
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

app.listen(5000, () => {
  console.log('Backend corriendo en puerto 5000');
});
