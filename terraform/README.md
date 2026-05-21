# Terraform - AWS EKS para Advance Trading

Este módulo de Terraform crea un clúster **Amazon EKS** (Elastic Kubernetes Service) en AWS para desplegar la plataforma Advance Trading.

## Requisitos

- [Terraform](https://developer.hashicorp.com/terraform/downloads) >= 1.5.0
- [AWS CLI](https://aws.amazon.com/cli/) configurado con credenciales
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- Una cuenta de AWS con permisos para crear EKS, VPC, EC2, IAM

## Configuración

### 1. Variables de AWS

Asegúrate de tener el AWS CLI configurado:

```bash
aws configure
# AWS Access Key ID: tu_access_key
# AWS Secret Access Key: tu_secret_key
# Default region: us-east-1
```

### 2. Inicializar Terraform

```bash
cd terraform
terraform init
```

### 3. Personalizar variables (opcional)

Crear un archivo `terraform.tfvars`:

```hcl
aws_region          = "us-east-1"
cluster_name        = "advance-trading"
cluster_version     = "1.30"
node_group_instance_types = ["t3.medium"]
node_group_min_size       = 2
node_group_max_size       = 3
node_group_desired_size   = 2
```

### 4. Revisar el plan

```bash
terraform plan -out=plan.tfplan
```

### 5. Crear el clúster

```bash
terraform apply plan.tfplan
```

La creación del clúster toma aproximadamente **15-20 minutos**.

### 6. Conectar kubectl al clúster

```bash
aws eks update-kubeconfig --region us-east-1 --name advance-trading-us-east-1
```

### 7. Desplegar la aplicación

```bash
kubectl apply -k ../k8s/
```

### 8. Verificar

```bash
kubectl get pods -n advance-trading
kubectl get svc -n advance-trading
```

## Destruir el clúster

**Importante**: Esto elimina todos los recursos (VPC, nodos, clúster).

```bash
terraform destroy
```

## Estructura

| Archivo | Descripción |
|---|---|
| `versions.tf` | Versiones de Terraform y proveedores |
| `providers.tf` | Proveedor AWS |
| `variables.tf` | Variables configurables |
| `main.tf` | VPC, EKS cluster, nodos workers, IAM |
| `outputs.tf` | Endpoint, kubeconfig, security group |
| `README.md` | Esta documentación |

## Recursos creados

| Recurso | Descripción |
|---|---|
| **VPC** | Red virtual con CIDR 10.0.0.0/16 |
| **Subnets públicas** | 3 subnets para load balancers |
| **Subnets privadas** | 3 subnets para nodos workers |
| **NAT Gateway** | Para que los nodos privados tengan salida a internet |
| **EKS Cluster** | Clúster de Kubernetes administrado |
| **Node Group** | Grupo de instancias EC2 (t3.medium) como nodos workers |
| **IAM Roles** | Roles para el clúster y los nodos |
| **Security Groups** | Reglas de firewall para el tráfico del clúster |

## Costos estimados

Aproximadamente **$70-100 USD/mes** con 2 nodos t3.medium:
- 2 x t3.medium (~$30 c/u)
- EKS cluster (~$73/mes)
- NAT Gateway (~$32/mes)
- Balanceador de carga (~$20/mes)

**Para ahorrar costos**: Usar `t3.small` o `t3.micro` para pruebas.
