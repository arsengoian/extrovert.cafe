output "ip" {
  description = "Публічна адреса дроплета — її ж у DNS для api.extrovert.cafe"
  value       = digitalocean_droplet.public.ipv4_address
}

output "ipv6" {
  value = digitalocean_droplet.public.ipv6_address
}

output "ssh" {
  description = "Готова команда для входу. Порт 2222, бо з частини мереж вихідний 22 закритий — на сервері слухають обидва"
  value       = "ssh -i keys/extrovert_ed25519 -p 2222 root@${digitalocean_droplet.public.ipv4_address}"
}

output "private_ip" {
  description = "Адреса у VPC: через неї говоритимуть дроплети між собою"
  value       = digitalocean_droplet.public.ipv4_address_private
}
