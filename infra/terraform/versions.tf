# Версії закріплені точно, як і образи в docker-compose: «останній
# провайдер» на двох машинах — це два різні плани.
terraform {
  required_version = ">= 1.9.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.43"
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}
