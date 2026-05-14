
# Advance Trading

Plataforma de trading de criptomonedas con pagos reales en MercadoPago (Colombia/Latam), seguridad de doble factor (2FA), cifrado AES-256, y un asistente interactivo 3D (AdvanceBot) con rostro robótico LED.

## Stack Tecnológico

| Componente | Tecnología |
|---|---|
| **Frontend** | HTML, CSS, JavaScript Vanilla (Liquid Glass UI) |
| **Backend** | Node.js + Express |
| **Base de Datos** | PostgreSQL 16 |
| **Contenedores** | Docker Compose |
| **Pagos** | MercadoPago SDK v2 (Colombia/Latam) |
| **Seguridad** | Helmet, bcrypt, AES-256-CBC, express-rate-limit, express-validator |
| **Email** | Nodemailer + Gmail SMTP |
| **Orquestación** | Kubernetes (básico) |

## Características

### 🧠 AdvanceBot
- Asistente interactivo 3D con rostro robótico LED neon
- 12 expresiones faciales: normal, pensando, hablando, feliz, triste, emocionado, cool, guiño, risa, dinero, sorprendido, amor, sospechoso
- Arrastrable por la interfaz
- Guía al usuario en inversiones y operaciones

### 💰 Pagos con MercadoPago
- Depósitos en COP (Pesos Colombianos) vía PSE, Efecty, Baloto, tarjetas bancarias
- Retiros a cuentas bancarias colombianas
- Tipo de cambio dinámico COP/USD via API externa
- Webhook para confirmación de pagos en tiempo real
- Registro completo de cada pago en la tabla `mercadopago_payments`

### 🔐 Seguridad
- **2FA** para depósitos y retiros: código email + PIN de 6 dígitos
- **AES-256-CBC** para cifrar montos sensibles en base de datos
- **Rate limiting** global, por auth, y por pagos
- **Helmet** headers de seguridad
- **Sanitización XSS** en inputs de usuario
- **CORS** restringido a orígenes permitidos
- **Validación** con express-validator en todos los endpoints
- **Protección SQL Injection** en URLs de notificación

### 📊 Base de Datos
- `usuarios` — cuentas con saldo y PIN de seguridad
- `transacciones` — historial de compra/venta de criptos
- `portafolios` — tenencias de criptomonedas por usuario
- `monedas` — catálogo de criptomonedas (BTC, ETH, BNB, SOL)
- `mercadopago_payments` — todos los pagos con detalle completo
- `deposit_log` / `withdrawal_log` — registro de movimientos
- `trade_audit` — auditoría de operaciones
- `access_log` — registro de accesos
- `balance_snapshots` — instantáneas de saldo

### 🖥️ API Endpoints

#### Autenticación
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/send-code` | Enviar código de verificación al email |
| POST | `/api/register` | Registrar nuevo usuario |
| POST | `/api/login` | Iniciar sesión |
| POST | `/api/forgot-password` | Solicitar recuperación de contraseña |
| POST | `/api/verify-reset-code` | Verificar código de recuperación |
| POST | `/api/reset-password` | Restablecer contraseña |

#### Trading
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/precios` | Obtener precios de criptomonedas |
| POST | `/api/trade` | Ejecutar compra/venta |
| GET | `/api/usuario/:id/portafolio` | Obtener portafolio del usuario |
| GET | `/api/user/:id/transaction-history` | Historial de transacciones |

#### Pagos MercadoPago
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/payment/create` | Iniciar depósito (envía código 2FA) |
| POST | `/api/payment/confirm` | Confirmar depósito con 2FA y crear pago |
| POST | `/api/payment/webhook` | Webhook de MercadoPago |
| POST | `/api/withdraw` | Solicitar retiro (envía código 2FA) |
| POST | `/api/withdraw/confirm` | Confirmar retiro con 2FA |
| GET | `/api/user/:id/mercadopago-history` | Historial de pagos MP |
| GET | `/api/user/:id/financial-summary` | Resumen financiero |

#### Seguridad
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/user/:id/set-pin` | Configurar PIN de seguridad |
| POST | `/api/user/:id/verify-pin` | Verificar PIN |

#### Auditoría
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/usuario/:id/access-log` | Registro de accesos |
| GET | `/api/usuario/:id/trade-audit` | Auditoría de trades |
| GET | `/api/usuario/:id/balance-history` | Historial de saldo |

## Requisitos

- Docker y Docker Compose instalados
- Windows: Docker Desktop (con WSL2 o Hyper-V)
- Linux/Mac: Docker Engine + Docker Compose

## Configuración

### 1. Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
# SMTP (Gmail)
SMTP_USER=tu_correo@gmail.com
SMTP_PASS=tu_app_password

# Encriptación AES-256 (64 caracteres hex)
ENCRYPTION_KEY=tu_clave_de_64_caracteres_hex

# MercadoPago (sandbox o producción)
MERCADOPAGO_ACCESS_TOKEN=TEST-xxxxxxxxxxxx
MERCADOPAGO_PUBLIC_KEY=TEST-yyyyyyyyyyyy
```

### 2. Iniciar Contenedores

```bash
docker compose up -d --build
```

Esto levanta:
- **Frontend**: `http://localhost:3000`
- **Backend**: `http://localhost:5000`
- **PostgreSQL**: puerto `5434` (mapeado a `5432` interno)

### 3. Conectar DBeaver (opcional)

| Campo | Valor |
|---|---|
| Host | `localhost` |
| Puerto | `5434` |
| Base de datos | `advance` |
| Usuario | `postgres` |
| Contraseña | `postgres` |
| SSL | Desactivado |

## Uso

1. Abrir `http://localhost:3000`
2. Crear una cuenta con nombre, email y contraseña
3. Revisar el email para el código de verificación
4. Iniciar sesión
5. Explorar el dashboard, ver precios de criptomonedas
6. **Depositar**: ir a Billetera → ingresar monto en COP → confirmar con código email + PIN
7. **Operar**: comprar/vender BTC, ETH, BNB, SOL
8. **Retirar**: solicitar retiro a cuenta bancaria colombiana con 2FA
9. Consultar historial de transacciones, accesos y auditoría

## Notas Importantes

- El webhook de MercadoPago (`/api/payment/webhook`) requiere una URL pública HTTPS en producción (ej: ngrok o dominio real)
- Los códigos de verificación expiran en 10 minutos
- El PIN de seguridad es de 6 dígitos y se configura desde Ajustes
- El saldo inicial de prueba es $10,000 USD
- Los contenedores del backend y frontend se reconstruyen automáticamente con `docker compose up -d --build`

## Solución de Problemas

**DBeaver no conecta**: Verifica que no haya otro PostgreSQL local en el puerto. Docker usa `5434`. Detén servicios PostgreSQL locales con `net stop postgresql-x64-*` (como Administrador).

**Error SMTP "Missing credentials"**: Asegúrate de que las variables `SMTP_USER` y `SMTP_PASS` estén definidas en el archivo `.env` de la raíz del proyecto.

**Backend no inicia**: Revisa los logs con `docker logs advance-trading-backend-1`.

## Despliegue en Producción

Para producción se incluyen manifiestos Kubernetes básicos en `k8s/`. Se recomienda:

- Usar un dominio real con HTTPS
- Configurar `notification_url` público para webhooks de MercadoPago
- Usar tokens de producción de MercadoPago (no sandbox)
- Configurar un proxy inverso (Nginx) para SSL
- No exponer el puerto de PostgreSQL públicamente

## Seguridad

- Todos los montos sensibles se almacenan cifrados con AES-256-CBC
- Las contraseñas se hashean con bcrypt
- Rate limiting previene ataques de fuerza bruta
- Helmet protege contra vulnerabilidades HTTP comunes
- Sanitización de inputs contra XSS
- Validación de todos los endpoints con express-validator
- CORS restringido
