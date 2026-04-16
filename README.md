# Advance Trading

Proyecto que incluye un frontend básico, un backend en Express (Node.js) y una base de datos PostgreSQL. Todo está configurado para desplegarse localmente con Docker Compose.

## Estructura de Proyecto
- `frontend/`: Archivos HTML servidos mediante Nginx (Puerto 3000 -> 80).
- `backend/`: Backend de Node.js (Puerto 5000).
- `db/`: Inicialización de la base de datos PostgreSQL.
- `k8s/`: Manifiestos básicos para despliegue en Kubernetes.

## Despliegue con Docker Compose
1. Asegúrate de tener Docker y Docker Compose instalados.
2. Ejecuta el siguiente comando en la raíz del proyecto:
   ```bash
   docker-compose up -d --build
   ```
3. Accede al frontend en [http://localhost:3000](http://localhost:3000)
4. El backend estará disponible en [http://localhost:5000/api/precios](http://localhost:5000/api/precios)
