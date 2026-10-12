# Fork build: upstream's Dockerfile pulls its cross toolchain from a private
# registry. Build the same toolchain from Dockerfile.ci (public inputs only)
# and feed it in as a named build context, so Dockerfile stays untouched.
#
#   docker buildx bake                     # local, amd64
#   PLATFORMS=linux/amd64,linux/arm64 docker buildx bake

variable "PLATFORMS" {
  default = "linux/amd64"
}

variable "RELEASE_OPTIMIZED" {
  default = "false"
}

variable "RUSTNZB_BUILD_REF" {
  default = "local"
}

group "default" {
  targets = ["rustnzb"]
}

target "cross-toolchain" {
  dockerfile = "Dockerfile.ci"
  target     = "cross"
  platforms  = ["linux/amd64"]
}

# docker/metadata-action fills tags and labels in CI.
target "docker-metadata-action" {}

target "rustnzb" {
  inherits   = ["docker-metadata-action"]
  dockerfile = "Dockerfile"
  contexts = {
    cross-toolchain = "target:cross-toolchain"
  }
  args = {
    CROSS_IMAGE       = "cross-toolchain"
    RELEASE_OPTIMIZED = RELEASE_OPTIMIZED
    RUSTNZB_BUILD_REF = RUSTNZB_BUILD_REF
  }
  platforms = split(",", PLATFORMS)
}
