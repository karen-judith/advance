# Advance Trading

Plataforma de trading de criptomonedas con pagos reales en MercadoPago (Colombia/Latam), seguridad de doble factor (2FA), cifrado AES-256, asistente interactivo 3D (AdvanceBot) con rostro robótico LED, y monitoreo completo con métricas, logs y trazas distribuidas.

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
| **Monitoreo** | Grafana 11 + Loki 3 + Prometheus 2.53 + Tempo 2.6 + Promtail 3 |
| **Trazas** | OpenTelemetry (instrumentación HTTP, Express, PostgreSQL) |
| **Métricas** | prom-client (CPU, memoria, duración de requests) |
| **Orquestación** | Kubernetes (kind local, manifiestos en `k8s/`) |
| **Imágenes Docker** | Docker Hub: `karenhjhi/advance-trading-backend`, `karenhjhi/advance-trading-frontend` |

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
- `usuarios` — cuentas con saldo (comienza en $0.00) y PIN de seguridad
- `transacciones` — historial de compra/venta de criptos
- `portafolios` — tenencias de criptomonedas por usuario
- `monedas` — catálogo de criptomonedas (BTC, ETH, BNB, SOL)
- `mercadopago_payments` — todos los pagos con detalle completo
- `deposit_log` / `withdrawal_log` — registro de movimientos
- `trade_audit` — auditoría de operaciones
- `access_log` — registro de accesos
- `balance_snapshots` — instantáneas de saldo

### 📈 Monitoreo completo (Grafana + Loki + Prometheus + Tempo)

| Componente | Función | Puerto |
|---|---|---|
| **Loki** | Almacena y centraliza logs de la aplicación | 3100 |
| **Promtail** | Recolecta logs de Docker y los envía a Loki | - |
| **Prometheus** | Almacena métricas (CPU, memoria, duración de requests) | 9090 |
| **Tempo** | Almacena trazas distribuidas (seguimiento de peticiones completas) | 3200 / 4318 |
| **Grafana** | Dashboard unificado para visualizar logs + métricas + trazas | 3101 |

Acceso a Grafana: `http://localhost:3101` — usuario: `admin`, contraseña: `advance2024`

**Datasources preconfigurados:**
- **Loki** para consultar logs con queries como `{container="advance-trading-backend-1"} |= "error"`
- **Prometheus** para métricas como `http_request_duration_seconds_count`, `process_cpu_seconds_total`
- **Tempo** para buscar trazas por servicio y ver el recorrido completo de cada petición

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

#### Monitoreo
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/metrics` | Métricas en formato Prometheus (CPU, memoria, duración de requests) |

### ☸️ Despliegue en Kubernetes

La carpeta `k8s/` contiene **13 manifiestos** listos para desplegar en un clúster Kubernetes (compatible con kind, Docker Desktop, minikube o producción):

| Archivo | Tipo | Función |
|---|---|---|
| `namespace.yaml` | Namespace | Aísla todos los recursos en `advance-trading` |
| `configmap.yaml` | ConfigMap | Variables no secretas (SMTP, CORS, DB_URL) |
| `secret.yaml` | Secret | Credenciales SMTP, ENCRYPTION_KEY, MercadoPago tokens |
| `db-init-configmap.yaml` | ConfigMap | Script SQL inicial (tablas, monedas) |
| `deployment-db.yaml` | Deployment | PostgreSQL 16 (1 réplica, 10GB persistente) |
| `pvc-db.yaml` | PersistentVolumeClaim | 10GB de almacenamiento persistente para la DB |
| `service-db.yaml` | Service | Expone PostgreSQL internamente como `db:5432` |
| `deployment-backend.yaml` | Deployment | API Node.js (1 réplica, imagen Docker Hub) |
| `service-backend.yaml` | Service | Expone backend internamente como `backend-service:5000` |
| `deployment-frontend.yaml` | Deployment | Frontend con Nginx (2 réplicas, imagen Docker Hub) |
| `service-frontend.yaml` | Service | Expone frontend como `ClusterIP` en puerto 80 |
| `ingress.yaml` | Ingress | Enruta tráfico: `/` → frontend, `/api` → backend |
| `kustomization.yaml` | Kustomization | Orquestador que aplica todos los manifiestos juntos |

El clúster actual (Docker Desktop Kubernetes) tiene el namespace `advance-trading` activo con los pods funcionando:

```bash
kubectl get pods -n advance-trading
NAME                        READY   STATUS    RESTARTS   AGE
backend-6f4c94bc94-fss9q    1/1     Running   0          22m
frontend-86b5f549ff-7tbp5   1/1     Running   0          23m
frontend-86b5f549ff-8csvp   1/1     Running   0          23m
postgres-c8f78968d-f8zkl    1/1     Running   0          28m
```

Para desplegar o actualizar:
```bash
kubectl apply -k k8s/
```

### 🔄 GitOps con ArgoCD

La carpeta `argocd/` contiene los manifiestos para sincronización automática (GitOps) usando **ArgoCD**:

| Archivo | Descripción |
|---|---|
| `project.yaml` | Define el proyecto ArgoCD con permisos y orígenes |
| `application.yaml` | Application que apunta a `https://github.com/karen-judith/advance.git` (rama `main`) y sincroniza `k8s/` |
| `install.ps1` | Script de instalación automática para Windows PowerShell |

**Instalación rápida:**
```powershell
.\argocd\install.ps1
```

Esto instala ArgoCD en el namespace `argocd`, aplica el project y application, y ArgoCD sincroniza automáticamente los manifiestos de `k8s/` desde GitHub.

**Características de la sincronización:**
- `prune: true` — elimina recursos que ya no están en Git
- `selfHeal: true` — revierte cambios manuales al estado de Git
- `CreateNamespace: true` — crea el namespace automáticamente
- Hasta 5 reintentos con backoff progresivo

**Comandos útiles:**
```bash
# Acceder al panel web de ArgoCD
kubectl port-forward -n argocd service/argocd-server 8080:443
# Abrir https://localhost:8080 (usuario: admin)

# Ver aplicaciones sincronizadas
kubectl get applications -n argocd

# Forzar sincronización manual
kubectl exec -n argocd deploy/argocd-server -- argocd app sync advance-trading
```

## Requisitos

- Docker y Docker Compose instalados
- Windows: Docker Desktop (con WSL2 o Hyper-V)
- Linux/Mac: Docker Engine + Docker Compose
- (Opcional) kind para Kubernetes local

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

Esto levanta **8 servicios**:

| Servicio | URL / Puerto | Función |
|---|---|---|
| **Frontend** | `http://localhost:3000` | Interfaz de usuario |
| **Backend** | `http://localhost:5000` | API + métricas `/metrics` |
| **PostgreSQL** | `localhost:5434` | Base de datos |
| **Loki** | `http://localhost:3100` | Almacenamiento de logs |
| **Promtail** | interno | Recolector de logs hacia Loki |
| **Prometheus** | `http://localhost:9090` | Métricas (CPU, memoria, requests) |
| **Tempo** | `localhost:3200` (4318 OTLP) | Trazas distribuidas |
| **Grafana** | `http://localhost:3101` (admin / advance2024) | Dashboard unificado |

### 3. Conectar DBeaver (opcional)

| Campo | Valor |
|---|---|
| Host | `localhost` |
| Puerto | `5434` |
| Base de datos | `advance` |
| Usuario | `postgres` |
| Contraseña | `postgres` |
| SSL | Desactivado |

> **Nota**: El puerto `5434` se usa porque Windows suele tener PostgreSQL 12/17 corriendo en el puerto `5433` nativo.

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

### Visualizar monitoreo en Grafana

```bash
# 1. Generar tráfico de prueba
./generate-traffic.sh
# O en PowerShell: ejecutar el script manualmente con curl

# 2. Abrir http://localhost:3101 (admin / advance2024)

# 3. Explorar:
#    - Métricas:   Explore > Prometheus > query: http_request_duration_seconds_count
#    - Trazas:     Explore > Tempo > Search > buscar trazas recientes
#    - Logs:       Explore > Loki > query: {container="advance-trading-backend-1"} |= "login"
```

## Notas Importantes

- **Saldo inicial**: Los nuevos usuarios comienzan con **$0.00 USD** (sin dinero de prueba)
- **Login**: No hay credenciales demo predefinidas — cada usuario debe registrarse
- **Webhook MercadoPago**: El endpoint `/api/payment/webhook` requiere una URL pública HTTPS en producción (ej: ngrok o dominio real)
- **Códigos de verificación**: Expiran en 10 minutos
- **PIN de seguridad**: 6 dígitos, se configura desde Ajustes
- **Reconstrucción**: `docker compose up -d --build` para rebuildear imágenes
- **Imágenes publicadas** en Docker Hub: `karenhjhi/advance-trading-backend:latest` y `karenhjhi/advance-trading-frontend:latest`
- **Trazas OpenTelemetry**: El backend envía trazas automáticamente a Tempo (OTLP HTTP, puerto 4318). Se instrumentan HTTP, Express y PostgreSQL.

## Solución de Problemas

**DBeaver no conecta**: Verifica que no haya otro PostgreSQL local. Docker usa `5434`. Detén servicios PostgreSQL locales con `net stop postgresql-x64-*` (como Administrador).

**Error SMTP "Missing credentials"**: Asegúrate de que `SMTP_USER` y `SMTP_PASS` estén definidos en `.env` en la raíz del proyecto.

**Backend no inicia**: Revisa los logs con `docker logs advance-trading-backend-1`.

**Loki no arranca**: Revisa los logs con `docker logs advance-loki`. Si hay errores de configuración, verifica `monitoring/loki-config.yaml` (debe usar `tsdb`, schema `v13`, y `wal.dir: /loki/wal`).

**Grafana no muestra logs**: Verifica que Loki esté corriendo (`curl http://localhost:3100/ready` debe responder `ready`).

**Prometheus no muestra métricas**: Verifica que el backend responda en `http://localhost:5000/metrics`.

**Tempo no recibe trazas**: Verifica que el backend tenga la variable `OTEL_EXPORTER_OTLP_ENDPOINT` apuntando a `http://tempo:4318/v1/traces`.

## Despliegue en Producción

Para producción se incluyen:

- **Manifiestos Kubernetes** en `k8s/` — aplicar con `kubectl apply -k k8s/`
- **GitOps con ArgoCD** en `argocd/` — sincronización automática desde GitHub
- **Infraestructura como Código** en `terraform/` — aprovisionamiento de EKS en AWS
- **Imágenes Docker Hub**: `karenhjhi/advance-trading-backend` y `karenhjhi/advance-trading-frontend`
- **kind**: Clúster local para pruebas (visible en `docker ps` como `docker-desktop`)

Recomendaciones:
- Usar un dominio real con HTTPS
- Configurar `notification_url` público para webhooks de MercadoPago
- Usar tokens de producción de MercadoPago (no sandbox)
- Configurar Ingress con TLS real
- No exponer el puerto de PostgreSQL públicamente
- Para producción en AWS: `cd terraform && terraform apply` (requiere credenciales AWS)

## Seguridad

- Todos los montos sensibles se almacenan cifrados con AES-256-CBC
- Las contraseñas se hashean con bcrypt
- Rate limiting previene ataques de fuerza bruta
- Helmet protege contra vulnerabilidades HTTP comunes
- Sanitización de inputs contra XSS
- Validación de todos los endpoints con express-validator
- CORS restringido
