group "default" {
  targets = ["wallet-frontend"]
}

target "docker-metadata-action" {}

target "wallet-frontend" {
  inherits = ["docker-metadata-action"]
}

target "release" {
  inherits = ["docker-metadata-action"]
  platforms = ["linux/amd64", "linux/arm64"]
}
