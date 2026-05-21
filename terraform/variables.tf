variable "aws_region" {
  description = "Región de AWS donde se creará el clúster"
  type        = string
  default     = "us-east-1"
}

variable "cluster_name" {
  description = "Nombre del clúster EKS"
  type        = string
  default     = "advance-trading"
}

variable "cluster_version" {
  description = "Versión de Kubernetes"
  type        = string
  default     = "1.30"
}

variable "vpc_cidr" {
  description = "Rango CIDR de la VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "private_subnets" {
  description = "Subnets privadas (donde irán los nodos)"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "public_subnets" {
  description = "Subnets públicas (para el load balancer)"
  type        = list(string)
  default     = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
}

variable "node_group_instance_types" {
  description = "Tipo de instancia para los nodos workers"
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_group_min_size" {
  description = "Mínimo de nodos workers"
  type        = number
  default     = 2
}

variable "node_group_max_size" {
  description = "Máximo de nodos workers"
  type        = number
  default     = 4
}

variable "node_group_desired_size" {
  description = "Cantidad deseada de nodos workers"
  type        = number
  default     = 2
}

variable "tags" {
  description = "Tags comunes para todos los recursos"
  type        = map(string)
  default = {
    Environment = "production"
    Project     = "advance-trading"
    ManagedBy   = "terraform"
  }
}
