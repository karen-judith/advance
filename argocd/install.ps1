# Script para instalar ArgoCD en kind/Docker Desktop
# y desplegar Advance Trading automaticamente

Write-Host "=== Instalando ArgoCD en Kubernetes ===" -ForegroundColor Cyan

Write-Host "`n1. Creando namespace argocd..." -ForegroundColor Yellow
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -

Write-Host "`n2. Instalando ArgoCD..." -ForegroundColor Yellow
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

Write-Host "`n3. Esperando a que ArgoCD este listo..." -ForegroundColor Yellow
kubectl wait --for=condition=available --timeout=300s -n argocd deployment/argocd-server

Write-Host "`n4. Aplicando Project y Application de Advance Trading..." -ForegroundColor Yellow
kubectl apply -f "$PSScriptRoot/project.yaml"
kubectl apply -f "$PSScriptRoot/application.yaml"

Write-Host "`n5. Obteniendo password de admin de ArgoCD..." -ForegroundColor Yellow
$ARGOPWD = kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" 2>$null
if ($ARGOPWD) {
    $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($ARGOPWD))
    Write-Host "   Password: $decoded" -ForegroundColor Green
} else {
    Write-Host "   (El password estara disponible cuando el pod termine de iniciar)" -ForegroundColor Gray
}

Write-Host "`n=== Listo! ===" -ForegroundColor Green
Write-Host "`nAcceder a ArgoCD:" -ForegroundColor Cyan
Write-Host "   kubectl port-forward -n argocd service/argocd-server 8080:443" -ForegroundColor White
Write-Host "   https://localhost:8080" -ForegroundColor White
Write-Host "   Usuario: admin" -ForegroundColor White
Write-Host "   Password: (el de arriba)" -ForegroundColor White

Write-Host "`nPara ver la aplicacion sincronizandose:" -ForegroundColor Cyan
Write-Host "   kubectl get applications -n argocd -w" -ForegroundColor White

Write-Host "`nApp desplegada en:" -ForegroundColor Cyan
Write-Host "   Frontend: kubectl port-forward -n advance-trading service/frontend 3001:80" -ForegroundColor White
Write-Host "   Backend:  kubectl port-forward -n advance-trading service/backend 5001:5000" -ForegroundColor White
