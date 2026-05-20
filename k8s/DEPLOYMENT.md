# Guía de despliegue en Kubernetes para Advance Trading

## Requisitos previos

- Kubernetes cluster activo (minikube, Docker Desktop con K8s, o un cluster remoto)
- kubectl configurado y conectado al cluster
- Las imágenes Docker compiladas y disponibles:
  - `advance-trading-backend:latest`
  - `advance-trading-frontend:latest`
  - `postgres:16` (disponible en Docker Hub)

## Estructura de manifiestos

```
k8s/
├── 01-namespace.yaml              # Namespace para aislar recursos
├── 02-configmap.yaml              # Variables de configuración no sensibles
├── 03-secret.yaml                 # Variables sensibles (contraseñas, tokens)
├── 04-postgres-pv.yaml            # Persistent Volume para PostgreSQL
├── 05-postgres-init-configmap.yaml # Script SQL de inicialización
├── 06-postgres-deployment.yaml    # Deployment + Service de PostgreSQL
├── 07-backend-deployment.yaml     # Deployment + Service del Backend
├── 08-frontend-deployment.yaml    # Deployment + Service del Frontend
└── DEPLOYMENT.md                  # Este archivo
```

## Paso a paso de despliegue

### Paso 1: Construir imágenes Docker

Asegúrate de que las imágenes estén disponibles en tu cluster. Si usas minikube o Docker Desktop:

```bash
cd advance-trading

# Backend
docker build -t advance-trading-backend:latest ./backend

# Frontend
docker build -t advance-trading-frontend:latest ./frontend
```

Si usas un registro privado (Docker Hub, ECR, etc), sube las imágenes:

```bash
docker tag advance-trading-backend:latest tu-usuario/advance-trading-backend:latest
docker push tu-usuario/advance-trading-backend:latest

docker tag advance-trading-frontend:latest tu-usuario/advance-trading-frontend:latest
docker push tu-usuario/advance-trading-frontend:latest
```

Luego actualiza los nombres en `07-backend-deployment.yaml` y `08-frontend-deployment.yaml`.

### Paso 2: Desplegar en Kubernetes

```bash
cd k8s

# Aplicar todos los manifiestos en orden
kubectl apply -f 01-namespace.yaml
kubectl apply -f 02-configmap.yaml
kubectl apply -f 03-secret.yaml
kubectl apply -f 04-postgres-pv.yaml
kubectl apply -f 05-postgres-init-configmap.yaml
kubectl apply -f 06-postgres-deployment.yaml
kubectl apply -f 07-backend-deployment.yaml
kubectl apply -f 08-frontend-deployment.yaml
```

O aplicarlos todos de una vez:

```bash
kubectl apply -f .
```

### Paso 3: Verificar el despliegue

```bash
# Ver estado de los pods
kubectl get pods -n advance-trading

# Ver services
kubectl get svc -n advance-trading

# Ver deployments
kubectl get deployments -n advance-trading

# Ver persistent volumes
kubectl get pv,pvc -n advance-trading
```

### Paso 4: Acceder a los servicios

**Frontend:**
```bash
kubectl port-forward -n advance-trading svc/frontend-service 3000:80
# Abre http://localhost:3000
```

**Backend:**
```bash
kubectl port-forward -n advance-trading svc/backend-service 5000:5000
# Accede a http://localhost:5000
```

**PostgreSQL (para herramientas como DBeaver):**
```bash
kubectl port-forward -n advance-trading svc/postgres-service 5432:5432
# Conecta a localhost:5432 con:
# - Usuario: postgres
# - Contraseña: postgres
# - Base de datos: advance
```

## Logs y debugging

### Ver logs de un pod

```bash
# Backend
kubectl logs -n advance-trading deployment/backend --tail=100

# Frontend
kubectl logs -n advance-trading deployment/frontend --tail=100

# PostgreSQL
kubectl logs -n advance-trading deployment/postgres --tail=100

# Logs en tiempo real
kubectl logs -n advance-trading deployment/backend -f
```

### Describir un pod (para ver errores)

```bash
kubectl describe pod -n advance-trading <pod-name>
```

### Acceder a un pod interactivamente

```bash
# PostgreSQL
kubectl exec -it -n advance-trading deployment/postgres -- psql -U postgres -d advance

# Backend
kubectl exec -it -n advance-trading deployment/backend -- /bin/bash
```

### Ver eventos del namespace

```bash
kubectl get events -n advance-trading --sort-by='.lastTimestamp'
```

## Scaling

### Aumentar réplicas del Backend

```bash
kubectl scale deployment/backend -n advance-trading --replicas=3
```

### Aumentar réplicas del Frontend

```bash
kubectl scale deployment/frontend -n advance-trading --replicas=3
```

## Actualizar variables de entorno

### Actualizar ConfigMap

```bash
kubectl edit configmap advance-config -n advance-trading
# Edita el archivo en tu editor
# Guarda con :wq
```

### Actualizar Secret

```bash
kubectl edit secret advance-secrets -n advance-trading
# Los valores están en base64, puedes editarlos directamente
```

Después de actualizar, reinicia los pods:

```bash
kubectl rollout restart deployment/backend -n advance-trading
kubectl rollout restart deployment/frontend -n advance-trading
```

## Eliminar todo

```bash
# Eliminar el namespace (elimina todos los recursos dentro)
kubectl delete namespace advance-trading

# O eliminar recursos individuales
kubectl delete -f k8s/
```

## Notas importantes

1. **Persistent Volume**: El path `/mnt/data/postgres` debe existir en el nodo. Para producción, usa un storage class administrado (EBS, GCE Persistent Disk, etc).

2. **Imágenes Docker**: Los nombres `advance-trading-backend:latest` y `advance-trading-frontend:latest` asumen que están en el cluster local. Para producción, usa un registro y actualiza los nombres.

3. **Database URL**: Usa `postgres-service:5432` dentro del cluster (pods en el mismo namespace). Para acceso externo, usa `kubectl port-forward`.

4. **Secrets**: Los valores en `03-secret.yaml` están en plain text por simplicidad. Para producción, usa herramientas como Sealed Secrets, External Secrets, o HashiCorp Vault.

5. **LoadBalancer**: El servicio frontend usa tipo `LoadBalancer`. En entornos locales (minikube, Docker Desktop), asigna una IP interna. En cloud (AWS, GCP, Azure), asigna una IP pública.

6. **Health Checks**: Los Liveness y Readiness Probes asumen que `/health` existe en el backend. Si tu aplicación no lo tiene, ajusta los paths o elimina los probes.

7. **Replicas**: Backend y Frontend tienen 2 réplicas por defecto. PostgreSQL tiene 1 (StatefulSets sería mejor para producción).

## Próximos pasos

- Configurar Ingress para acceso HTTP/HTTPS
- Implementar StatefulSet para PostgreSQL
- Agregar NetworkPolicies para seguridad
- Configurar HorizontalPodAutoscaler
- Implementar helm charts para versionado de manifiestos
- Configurar CI/CD (GitOps con ArgoCD o Flux)
