variable "source_commit" { type = string }
variable "run_id" { type = string }
variable "round_limit" {
  type = number
  default = 20
}
variable "resume" {
  type = bool
  default = false
}
variable "source_directory" {
  type = string
  default = "source"
}
variable "image" {
  type = string
  default = "sha256:c714d1cd66307893c444945190abdabf8e7f9b1f8edd24730a704109f6080e9b"
}
variable "offline" {
  type = bool
  default = false
}

# The bounded experiment uses the existing Xean Lab image and host volume.
# Supply XEAN_API_KEY only in the task Env of the JSON submission, never in HCL.
# Set the rendered job ID and name to xean-RUN_ID before submitting.
job "xean-bounded-template" {
  type = "batch"
  datacenters = ["lab"]
  meta {
    fleet_run_id = var.run_id
    fleet_run_kind = "xean-experiment"
    fleet_owner = "xean"
    source_repo = "local:xean"
    source_commit = var.source_commit
    round_limit = "${var.round_limit}"
  }
  constraint {
    attribute = "${node.unique.name}"
    value = "jupiter"
  }
  reschedule { attempts = 0 }
  group "solver" {
    restart {
      attempts = 0
      mode = "fail"
    }
    volume "runs" {
      type = "host"
      source = "xean_lab_runs"
      read_only = false
    }
    task "solver" {
      driver = "docker"
      user = "1000:1000"
      kill_signal = "SIGINT"
      kill_timeout = "60s"
      config {
        image = var.image
        force_pull = false
        entrypoint = ["/runs/_xean/${var.run_id}/runtime/bun"]
        args = concat([
          "--config=/runs/_xean/${var.run_id}/runtime/bun-runtime.toml",
          "--no-install", "--no-env-file",
          "/runs/_xean/${var.run_id}/${var.source_directory}/scripts/bounded-solve.ts",
          "/runs/_xean/${var.run_id}",
          "--round-limit", "${var.round_limit}",
        ], var.offline ? ["--offline"] : [], var.resume ? ["--resume"] : [])
        network_mode = "bridge"
        readonly_rootfs = true
        cap_drop = ["ALL"]
        security_opt = ["no-new-privileges"]
        pids_limit = 1024
        mount {
          type = "tmpfs"
          target = "/scratch"
          tmpfs_options {
            size = 268435456
            mode = 1023
          }
        }
      }
      env {
        TMPDIR = "/scratch"
        HOME = "/scratch"
        CODEX_HOME = "/runs/_xean/${var.run_id}/runtime/codex-home"
        NODE_EXTRA_CA_CERTS = "/usr/local/share/ca-certificates/lab-root.crt"
      }
      volume_mount {
        volume = "runs"
        destination = "/runs"
        read_only = false
      }
      resources {
        cpu = 500
        memory = 512
        memory_max = 2048
      }
      logs {
        max_files = 4
        max_file_size = 20
      }
    }
  }
}
