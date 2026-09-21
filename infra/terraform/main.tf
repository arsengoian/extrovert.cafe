# Дроплет `public` і файрвол до нього. Поки один: другий (`analysis`, під
# відео) зʼявиться лише коли дійде до камер — його опис тримати заздалегідь
# немає сенсу (docs/deploy.md §2).

locals {
  name = "extrovert-public"

  # Скрипт установки докера лежить у репозиторії й їде в cloud-init як є —
  # щоб на сервері не було «іншої» версії того самого скрипта.
  install_docker_sh = file("${path.module}/../../docker/install-docker.sh")

  cloud_init = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    install_docker_sh = local.install_docker_sh
    swap_gb           = var.swap_gb
    ssh_extra_port    = var.ssh_extra_port
    debug_beacon      = var.debug_beacon
  })
}

# Ключ доступу. Приватна частина — в keys/ і в git не потрапляє
# (scripts/keys.mjs ssh).
resource "digitalocean_ssh_key" "deploy" {
  name       = "extrovert deploy key"
  public_key = trimspace(file("${path.module}/${var.ssh_public_key_path}"))
}

# Ключі людей уже лежать в акаунті DigitalOcean — беремо їх за іменем.
# Створювати копію не можна: DO не приймає той самий ключ двічі, а тримати
# його ще й у репозиторії означало б два джерела правди про доступ.
data "digitalocean_ssh_key" "people" {
  for_each = toset(var.ssh_key_names)
  name     = each.value
}

resource "digitalocean_droplet" "public" {
  name   = local.name
  region = var.region
  size   = var.size
  image  = var.image
  ssh_keys = concat(
    [digitalocean_ssh_key.deploy.fingerprint],
    [for k in data.digitalocean_ssh_key.people : k.fingerprint],
  )
  tags = var.tags

  # Приватна мережа: коли зʼявиться другий дроплет, вони говоритимуть між
  # собою через неї, а не через публічний інтернет.
  vpc_uuid = data.digitalocean_vpc.default.id

  monitoring = true
  ipv6       = true

  user_data = local.cloud_init

  lifecycle {
    # Зміна cloud-init не має перестворювати живий сервер: скрипт
    # виконується лише на першому завантаженні, і різниця в ньому — привід
    # зайти руками, а не втратити дані.
    ignore_changes = [user_data]

    # Один кириличний символ у user-data — і сервер підніметься порожнім.
    # DigitalOcean віддає user-data через config drive; не-ASCII байт ламає
    # його так, що cloud-init мовчки не виконує нічого: ні запасного порту
    # ssh, ні докера, ні помилки. Доведено зондами 21.09.2026 — і коштувало
    # пів дня, тому перевірка тут, а не в чиїйсь памʼяті.
    precondition {
      condition     = can(regex("^[\\x00-\\x7F]*$", local.cloud_init))
      error_message = "cloud-init: user-data містить не-ASCII символ. Коментарі в cloud-init.yaml.tftpl мають бути англійською (docs/deploy.md §2.1)."
    }
  }
}

data "digitalocean_vpc" "default" {
  region = var.region
}

# Файрвол DigitalOcean, а не ufw: докер пише власні правила в iptables повз
# ufw, і той створює ілюзію захисту (docs/deploy.md §2).
resource "digitalocean_firewall" "public" {
  name        = "${local.name}-fw"
  droplet_ids = [digitalocean_droplet.public.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.ssh_allowed_ips
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = tostring(var.ssh_extra_port)
    source_addresses = var.ssh_allowed_ips
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # ICMP лишаємо: без ping діагностика «а він узагалі живий» стає ворожінням.
  inbound_rule {
    protocol         = "icmp"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # Портів 3001-3003, 5432 і 6379 тут немає навмисно. Сервіси стануть за
  # проксі на 443, а база й Redis слухають лише петлю.

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

# Дроплет належить проєкту extrovert.cafe, а не default: у DigitalOcean
# проєкт — це не тег, а те, за чим рахуються витрати й фільтруються ресурси.
resource "digitalocean_project_resources" "public" {
  project = var.project_id

  resources = [
    digitalocean_droplet.public.urn,
  ]
}
