# Версії закріплені точно, як і образи в docker-compose: «останній
# провайдер» на двох машинах — це два різні плани.
terraform {
  required_version = ">= 1.9.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.43"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}

# Токен рівня акаунта з .env (CLOUDFLARE_API_TOKEN) через scripts/tf.mjs.
# В акаунті багато чужого — terraform торкається лише того, що описано в
# cloudflare.tf; решту він не бачить і не чіпає.
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
