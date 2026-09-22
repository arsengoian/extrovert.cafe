variable "cloudflare_api_token" {
  description = "Токен Cloudflare рівня акаунта. З .env (CLOUDFLARE_API_TOKEN) через scripts/tf.mjs"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Акаунт Cloudflare. З .env (CLOUDFLARE_ACCOUNT_ID) через scripts/tf.mjs"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Зона extrovert.cafe. Сама зона terraform-ом не керується — лише записи в ній"
  type        = string
  default     = "e3593ac2e5ede759bcc77e517a837519"
}

variable "do_token" {
  description = "Токен DigitalOcean. Береться з .env (DIGITALOCEAN_API_KEY) через scripts/tf.mjs"
  type        = string
  sensitive   = true
}

variable "region" {
  description = "Регіон: Франкфурт — найближчий до України з тих, де є все потрібне"
  type        = string
  default     = "fra1"
}

variable "size" {
  description = "Розмір дроплета public. s-1vcpu-2gb ≈ $12/міс; брак памʼяті компенсує swap"
  type        = string
  default     = "s-1vcpu-2gb"
}

variable "image" {
  description = "Базовий образ"
  type        = string
  default     = "ubuntu-24-04-x64"
}

variable "swap_gb" {
  description = "Скільки swap створити на першому завантаженні"
  type        = number
  default     = 2
}

variable "ssh_public_key_path" {
  description = "Публічний ключ, який пускають на сервер (keys/ у репозиторії, приватна частина в git не їде)"
  type        = string
  default     = "../../keys/extrovert_ed25519.pub"
}

# SSH навмисно відкритий усьому світу, але лише за ключем: пароля на
# сервері немає. Якщо колись буде статична адреса — сюди її, і порт 22
# зникне з інтернету зовсім.
variable "ssh_allowed_ips" {
  description = "Кому дозволено SSH"
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

# З деяких мереж (корпоративних, частини мобільних операторів) вихідний
# порт 22 закритий — перевірено 21.09.2026: із робочої машини не
# відкривається навіть github.com:22. Тому sshd слухає ще й запасний порт.
variable "ssh_extra_port" {
  description = "Додатковий порт sshd, коли 22 недоступний із мережі розробника"
  type        = number
  default     = 2222
}

# Живі люди, яким відкритий вхід. Імена — як у розділі Settings → Security
# кабінету DigitalOcean. Прибрати доступ = прибрати імʼя звідси й
# перестворити дроплет (DO кладе ключі лише при створенні).
variable "ssh_key_names" {
  description = "Наявні в акаунті ключі, які пускають на сервер"
  type        = list(string)
  default     = ["Arsen"]
}

variable "project_id" {
  description = "Проєкт DigitalOcean extrovert.cafe: без нього ресурси падають у default і губляться серед чужих"
  type        = string
  default     = "4c2a16a9-454d-409f-946f-1c11fab789a4"
}

variable "tags" {
  description = "Теги DigitalOcean: за ними ж чіпляється файрвол"
  type        = list(string)
  default     = ["extrovert", "public"]
}

# Маячок налагодження першого завантаження: сервер віддає на :80 стан
# cloud-init протягом 15 хвилин і вимикає його сам. Потрібен рівно тоді,
# коли ssh не піднявся й подивитися на сервер більше нічим. У звичайному
# стані — false: зайвий відкритий порт на проді не потрібен нікому.
variable "debug_beacon" {
  description = "Тимчасово віддавати стан завантаження на :80 (лише для діагностики)"
  type        = bool
  default     = false
}
