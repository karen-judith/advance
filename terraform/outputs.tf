output "cluster_name" {
  description = "Nombre del clúster EKS"
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "Endpoint del clúster (URL de la API de Kubernetes)"
  value       = module.eks.cluster_endpoint
}

output "cluster_certificate_authority" {
  description = "Certificado CA del clúster"
  value       = module.eks.cluster_certificate_authority_data
  sensitive   = true
}

output "cluster_security_group_id" {
  description = "ID del security group del clúster"
  value       = module.eks.cluster_security_group_id
}

output "region" {
  description = "Región de AWS"
  value       = var.aws_region
}

output "node_group_role" {
  description = "Nombre del IAM role de los nodos workers"
  value       = module.eks.eks_managed_node_groups["main"].iam_role_name
}

output "configure_kubectl" {
  description = "Comando para configurar kubectl local"
  value       = "aws eks update-kubeconfig --region ${var.aws_region} --name ${module.eks.cluster_name}"
}
