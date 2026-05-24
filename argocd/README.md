# ArgoCD - Advance Trading

Este directorio contiene los manifiestos para desplegar **ArgoCD** en el clúster Kubernetes (kind/Docker Desktop) y configurar la **sincronización automática (GitOps)** de la plataforma Advance Trading.

## ¿Qué es ArgoCD?

ArgoCD es una herramienta de **GitOps** que monitorea automáticamente un repositorio de Git y mantiene el clúster Kubernetes sincronizado con los manifiestos de ese repositorio. 

**Ventajas:**
- Cada vez que subís cambios a GitHub, ArgoCD los aplica automáticamente al clúster
- Si alguien modifica algo manualmente en el clúster, ArgoCD lo revierte al estado de Git
- Panel web con el estado visual de todos los recursos
- Historial de cambios con posibilidad de rollback

## Instalación

### 1. Requisitos

- Clúster Kubernetes corriendo (kind o Docker Desktop)
- `kubectl` configurado

### 2. Instalar ArgoCD + Advance Trading

```bash
# Windows PowerShell
.\argocd\install.ps1

# O manualmente paso a paso:
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

### 3. Esperar a que ArgoCD esté listo

```bash
kubectl wait --for=condition=available --timeout=300s -n argocd deployment/argocd-server
```

### 4. Aplicar Project y Application

```bash
kubectl apply -f argocd/project.yaml
kubectl apply -f argocd/application.yaml
```

### 5. Obtener password de admin

```bash
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 --decode
```

### 6. Acceder al panel web

```bash
kubectl port-forward -n argocd service/argocd-server 8080:443
```

Abrir `https://localhost:8080` — usuario: `admin`, password: (del paso 5)

## Arquitectura

```
┌─────────────────────────────────────────┐
│              GitHub                      │
│  https://github.com/karen-judith/advance │
│  └── k8s/ (manifiestos Kubernetes)       │
└──────────────┬──────────────────────────┘
               │ ArgoCD monitorea cambios
               ▼
┌─────────────────────────────────────────┐
│           ArgoCD (argocd namespace)      │
│  ┌──────────────┐  ┌──────────────────┐ │
│  │ advance-project│  │ advance-application│
│  └──────────────┘  └────────┬─────────┘ │
└──────────────────────────────┼──────────┘
                               │ sincroniza
                               ▼
┌─────────────────────────────────────────┐
│      Advance Trading (advance-trading)   │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐  │
│  │ frontend │ │ backend │ │    db    │  │
│  │ x2 pods  │ │ x2 pods │ │ 1 pod    │  │
│  └─────────┘ └─────────┘ └──────────┘  │
└─────────────────────────────────────────┘
```

## Archivos

| Archivo | Descripción |
|---|---|
| `project.yaml` | Define el proyecto ArgoCD con permisos y orígenes |
| `application.yaml` | Application que apunta al repo GitHub y sincroniza `k8s/` |
| `install.ps1` | Script de instalación automática para Windows |
| `README.md` | Esta documentación |

## Sincronización automática

La aplicación ArgoCD está configurada con:
- **automated.prune**: true — elimina recursos que ya no están en Git
- **automated.selfHeal**: true — revierte cambios manuales al estado de Git
- **syncOptions.CreateNamespace**: true — crea el namespace automáticamente
- **retry**: hasta 5 reintentos con backoff progresivo

## Comandos útiles

```bash
# Ver estado de la aplicación
kubectl get applications -n argocd

# Ver detalles y eventos
kubectl describe application -n argocd advance-trading

# Forzar sincronización manual
kubectl exec -n argocd deploy/argocd-server -- argocd app sync advance-trading

# Ver logs de ArgoCD
kubectl logs -n argocd -l app.kubernetes.io/name=argocd-server

# Acceder al frontend de la app
kubectl port-forward -n advance-trading service/frontend 3001:80
# Abrir http://localhost:3001

# Acceder al backend
kubectl port-forward -n advance-trading service/backend 5001:5000
# Probar: curl http://localhost:5001/api/precios
```
