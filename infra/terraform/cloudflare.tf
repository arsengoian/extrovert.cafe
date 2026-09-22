# Cloudflare: DNS, бакети R2 і домени воркерів extrovert.cafe.
#
# В акаунті Cloudflare багато стороннього, тож тут описане лише наше, і
# terraform бачить тільки це: зону extrovert.cafe (сама зона не керується —
# лише записи в ній), бакети extrovert-* і домени воркерів extrovert-*. Те,
# що вже існувало до terraform (записи Mailgun, бакет extrovert-pos),
# імпортоване блоками import, а не створене наново: план після імпорту не
# показує різниці.
#
# Код воркерів сюди не входить — його збирає й заливає wrangler
# (make deploy-client, deploy-admin, deploy-qr). Тут лише те, ДЕ вони
# відповідають: домени. Так прив'язка прод-домену — рішення, яке видно в
# плані, а не побічний ефект випадкового деплою.
#
# prevent_destroy — на всьому, втрата чого означає дані або пошту: бакети й
# записи Mailgun. Terraform відмовиться видаляти їх навіть у разі помилки в
# описі.
#
# Поза terraform навмисно: pos.extrovert.cafe — старий воркер extrovert-pos,
# з якого кіоск на kyiv-01 досі бере меню (docs/services.md §5). Його
# доля — окреме рішення разом зі зміною config/env на малині.

# ── Сервер: api, ws, помилки ────────────────────────────────────────────
#
# Прямо на дроплет, без проксі Cloudflare: Caddy сам бере сертифікати Let's
# Encrypt, а ws не впирається в таймаути проксі. Проксіювати api варто заради
# Safari (docs/services.md §3) — це proxied = true тут і перевірка, що Caddy
# далі отримує сертифікати.

locals {
  server_hosts = {
    api    = "api.extrovert.cafe"
    ws     = "ws.extrovert.cafe"
    errors = "errors.extrovert.cafe"
  }
}

resource "cloudflare_dns_record" "server_a" {
  for_each = local.server_hosts
  zone_id  = var.cloudflare_zone_id
  name     = each.value
  type     = "A"
  content  = digitalocean_droplet.public.ipv4_address
  ttl      = 1
  proxied  = false
  comment  = "extrovert: дроплет public (terraform)"
}

resource "cloudflare_dns_record" "server_aaaa" {
  for_each = local.server_hosts
  zone_id  = var.cloudflare_zone_id
  name     = each.value
  type     = "AAAA"
  content  = digitalocean_droplet.public.ipv6_address
  ttl      = 1
  proxied  = false
  comment  = "extrovert: дроплет public (terraform)"
}

# ── Пошта: Mailgun (mail.extrovert.cafe) ────────────────────────────────
#
# Заведені руками за інструкцією Mailgun ще до terraform. Без SPF і DKIM
# листи для входу падають у «Спам», а це єдиний вхід гравця.

resource "cloudflare_dns_record" "mail_dkim" {
  zone_id = var.cloudflare_zone_id
  name    = "k1._domainkey.mail.extrovert.cafe"
  type    = "TXT"
  content = "\"k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3edLV9l7VyJSF5EBvN93iZwtLN9cmrXdyAGLrfajK/wgi4DTvcn9IB9LUNzTI0vRUIQSGMATAQX09y5ci3gJHJor6JET3Gemel3jsS4huu9KTvwcmeoRUC3sW3YuDeDzd/ErFLR2Q1zoHXvqEHVN9VkSB9L9AekQAe4XDnNr/BgLyRvcgjEFkgEZZDtZFRPM0UavWoD1aI\" \"avyIBEZxlVU6LaUwfhapl6/imkSSuv795Zdn5E+dRr/Z3WRN5sYMmutV7AjnnyCwQKt/E4O/3AVcKpe648PE1oZhl+Tj1v2jKGirlMRh7KEB9Teo/2UHl53uHsG7RLqGrzEX6Y7oA6lQIDAQAB\""
  ttl     = 1
  proxied = false

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = cloudflare_dns_record.mail_dkim
  id = "${var.cloudflare_zone_id}/54b7d990a974fe9117002bcbc25aa16b"
}

resource "cloudflare_dns_record" "mail_dmarc" {
  zone_id = var.cloudflare_zone_id
  name    = "_dmarc.mail.extrovert.cafe"
  type    = "TXT"
  content = "\"v=DMARC1; p=none; rua=mailto:dmarc@extrovert.cafe\""
  ttl     = 1
  proxied = false

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = cloudflare_dns_record.mail_dmarc
  id = "${var.cloudflare_zone_id}/a808cb57774053d1c2672d0a235d6699"
}

resource "cloudflare_dns_record" "mail_mx_a" {
  zone_id  = var.cloudflare_zone_id
  name     = "mail.extrovert.cafe"
  type     = "MX"
  content  = "mxb.mailgun.org"
  ttl      = 1
  priority = 10
  proxied  = false

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = cloudflare_dns_record.mail_mx_a
  id = "${var.cloudflare_zone_id}/607fd293597a3104b75fe0f72fea5285"
}

resource "cloudflare_dns_record" "mail_mx_b" {
  zone_id  = var.cloudflare_zone_id
  name     = "mail.extrovert.cafe"
  type     = "MX"
  content  = "mxa.mailgun.org"
  ttl      = 1
  priority = 10
  proxied  = false

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = cloudflare_dns_record.mail_mx_b
  id = "${var.cloudflare_zone_id}/9473f008455bf0e8165d2baf100b5e67"
}

resource "cloudflare_dns_record" "mail_spf" {
  zone_id = var.cloudflare_zone_id
  name    = "mail.extrovert.cafe"
  type    = "TXT"
  content = "\"v=spf1 include:mailgun.org ~all\""
  ttl     = 1
  proxied = false

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = cloudflare_dns_record.mail_spf
  id = "${var.cloudflare_zone_id}/37a996f605fdcf74c670de04e6c6de85"
}

resource "cloudflare_dns_record" "mail_tracking" {
  zone_id = var.cloudflare_zone_id
  name    = "email.mail.extrovert.cafe"
  type    = "CNAME"
  content = "mailgun.org"
  ttl     = 1
  proxied = false

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = cloudflare_dns_record.mail_tracking
  id = "${var.cloudflare_zone_id}/52cf75a0f808005c8080e87dda6a7308"
}

# ── R2 ──────────────────────────────────────────────────────────────────
#
# Усі в default-юрисдикції з розташуванням EEUR, як уже наявний
# extrovert-pos: EU-юрисдикція має інший S3-ендпоїнт
# (<акаунт>.eu.r2.cloudflarestorage.com), і бакети в різних юрисдикціях
# потребували б різних ендпоїнтів і ключів (docs/deploy.md §2.2).

locals {
  buckets = {
    pos      = "extrovert-pos"      # меню точок і релізи кіоска
    uploads  = "extrovert-uploads"  # фото зі скарг гравців
    backups  = "extrovert-backups"  # щоденні дампи Postgres (scheduler)
    video    = "extrovert-video"    # сирі сегменти з камер, 7 днів
    evidence = "extrovert-evidence" # кадри й кліпи підтверджених подій
  }
}

resource "cloudflare_r2_bucket" "this" {
  for_each      = local.buckets
  account_id    = var.cloudflare_account_id
  name          = each.value
  location      = "EEUR"
  jurisdiction  = "default"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

import {
  to = cloudflare_r2_bucket.this["pos"]
  id = "${var.cloudflare_account_id}/extrovert-pos/default"
}

# Телефон заливає фото напряму за підписаним посиланням — без CORS браузер
# навіть не спробує.
resource "cloudflare_r2_bucket_cors" "uploads" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.this["uploads"].name
  rules = [{
    id              = "phone-upload"
    allowed         = { methods = ["PUT"], origins = ["https://extrovert.cafe"], headers = ["content-type"] }
    max_age_seconds = 3600
  }]
}

# Дампи бази: 30 днів — досить, щоб помітити пошкодження даних і відкотитись,
# і не платити за роки копій.
resource "cloudflare_r2_bucket_lifecycle" "backups" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.this["backups"].name
  rules = [{
    id                        = "expire-30d"
    enabled                   = true
    conditions                = { prefix = "" }
    delete_objects_transition = { condition = { type = "Age", max_age = 30 * 24 * 3600 } }
  }]
}

# Відео з камер живе тиждень і за цей тиждень не видаляється нікому —
# зокрема ключу, який лежить на малині (docs/video.md).
resource "cloudflare_r2_bucket_lifecycle" "video" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.this["video"].name
  rules = [{
    id                        = "expire-7d"
    enabled                   = true
    conditions                = { prefix = "" }
    delete_objects_transition = { condition = { type = "Age", max_age = 7 * 24 * 3600 } }
  }]
}

resource "cloudflare_r2_bucket_lock" "video" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.this["video"].name
  rules = [{
    id        = "lock-7d"
    enabled   = true
    prefix    = ""
    condition = { type = "Age", max_age_seconds = 7 * 24 * 3600 }
  }]
}

# ── Воркери: домени ─────────────────────────────────────────────────────
#
# Код заливає wrangler (make deploy-client, deploy-admin, deploy-qr,
# deploy-redirect), а де він відповідає — вирішує цей блок. Workers самі
# заводять під домен DNS-запис і сертифікат; руками в зоні їх не
# створювати. Скрипт має існувати до apply: домен на неіснуючий воркер
# Cloudflare не прив'яже.

locals {
  worker_domains = {
    client   = { hostname = "extrovert.cafe", service = "extrovert-client" }
    admin    = { hostname = "admin.extrovert.cafe", service = "extrovert-admin" }
    qr       = { hostname = "qr.extrovert.cafe", service = "extrovert-qr" }
    redirect = { hostname = "r.extrovert.cafe", service = "extrovert-redirect" }
  }
}

resource "cloudflare_workers_custom_domain" "this" {
  for_each   = local.worker_domains
  account_id = var.cloudflare_account_id
  zone_id    = var.cloudflare_zone_id
  hostname   = each.value.hostname
  service    = each.value.service
}
